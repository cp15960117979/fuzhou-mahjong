/**
 * 机器人长跑模拟（不做断言，只出统计）
 *   node tools/bot-sim.js [局数] [--legacy]
 * 用来对比"做大牌 AI"和旧版"能胡就胡 AI"的成牌结构。
 */
const { Room } = require('../src/game.js');
const BOT = require('../src/bot.js');

const N = Number(process.argv[2]) || 50;
const LEGACY = process.argv.includes('--legacy');

// ------- 旧版简化 AI（对照用，逻辑与改造前一致）-------
function legacyEval(hand, joker) {
  const { counts, jokers } = require('../src/mahjong.js').separateJokers(hand, joker);
  let s = jokers * 3;
  if (require('../src/mahjong.js').isTing(hand, joker)) s += 100;
  for (let base = 0; base < 27; base += 9) {
    for (let i = 0; i < 9; i++) {
      const c = counts[base + i];
      if (c >= 3) s += 3;
      else if (c === 2) s += 1.5;
      if (i <= 7 && c >= 1 && counts[base + i + 1] >= 1) s += 1;
      if (i <= 6 && c >= 1 && counts[base + i + 2] >= 1) s += 0.5;
      if (i <= 6 && c >= 1 && counts[base + i + 1] >= 1 && counts[base + i + 2] >= 1) s += 2;
    }
  }
  return s;
}

function legacyDecide(room, seat) {
  const p = room.getPlayer(seat);
  if (!p || !p.isBot) return;
  if (room.phase !== 'playing' && room.phase !== 'swap') return;
  const st = room.getState(seat);
  const acts = st.actions || [];
  const done = (res) => { if (res && !res.ok) room.log.push('legacy fail'); };
  if (st.phase === 'swap' && acts.includes('swap:chooseSuit')) {
    const cnt = { m: 0, s: 0, p: 0 };
    for (const t of p.hand) { const s = require('../src/mahjong.js').suitOf(t); if (cnt[s] != null) cnt[s]++; }
    const opts = ['m', 's', 'p'].filter((s) => cnt[s] >= 3).sort((a, b) => cnt[b] - cnt[a]);
    if (!opts.length) return;
    done(room.doSwap(seat, opts[0]));
    return;
  }
  if (acts.includes('hu')) {
    const res = st.pending ? room.claim(seat, 'hu') : room.selfHu(seat);
    if (!res || res.ok) return;
  }
  if (acts.includes('jinkan')) { const r0 = room.declareJinKan(seat); if (r0 && r0.ok) return; }
  if (acts.includes('ting')) { done(room.declareTing(seat)); return; }
  const ting = require('../src/mahjong.js').isTing(p.hand, room.joker);
  const ag = acts.find((a) => typeof a === 'string' && a.startsWith('angang:'));
  if (ag && !ting) { done(room.anGang(seat, Number(ag.split(':')[1]))); return; }
  const bg = acts.find((a) => typeof a === 'string' && a.startsWith('bugang:'));
  if (bg && !ting) { done(room.buGang(seat, Number(bg.split(':')[1]))); return; }
  if (acts.includes('discard') && p.isCurrent !== false) {
    const cand = [...new Set(p.hand)].filter((t) => t !== room.joker);
    const pool = cand.length ? cand : [...new Set(p.hand)];
    let best = pool[0], bs = -Infinity;
    for (const t of pool) {
      const rest = p.hand.slice();
      rest.splice(rest.indexOf(t), 1);
      const sc = legacyEval(rest, room.joker) + Math.random() * 0.1;
      if (sc > bs) { bs = sc; best = t; }
    }
    done(room.discard(seat, best));
    return;
  }
  if (st.pending && st.pending.seats.includes(seat)) {
    if (ting) { done(room.claim(seat, 'pass')); return; }
    if (acts.includes('gang')) { done(room.claim(seat, 'gang')); return; }
    if (acts.includes('peng')) { done(room.claim(seat, 'peng')); return; }
    const chi = acts.find((a) => a && a.act === 'chi');
    if (chi && chi.combos && chi.combos.length) { done(room.claim(seat, 'chi', { combo: chi.combos[0] })); return; }
    done(room.claim(seat, 'pass'));
  }
}

function clearTimers(room) {
  if (room._botTimers) { for (const t of Object.values(room._botTimers)) clearTimeout(t); room._botTimers = {}; }
}

function sig(room) {
  return [room.phase, room.turn, room.wall.length, room.log.length, room.pending ? room.pending.responded.size : -1].join('|');
}

function playOne(decide) {
  const room = new Room('SIM');
  for (let i = 0; i < 4; i++) { room.addPlayer(null, 'B' + i); room.getPlayer(i).isBot = true; }
  room.startGame();
  let steps = 0;
  let stalls = 0;
  while (room.phase !== 'ended' && steps < 4000) {
    clearTimers(room);
    const before = sig(room);
    let acted = false;
    for (const p of room.players) {
      const st = room.getState(p.seat);
      const has = (st.actions && st.actions.length) || (st.pending && st.pending.seats.includes(p.seat));
      if (!has) continue;
      decide(room, p.seat);
      acted = true;
      if (room.phase === 'ended') break;
    }
    if (!acted) break;
    if (sig(room) === before) { stalls++; if (stalls > 3) break; } else stalls = 0;
    steps++;
  }
  clearTimers(room);
  return { room, steps, stuck: room.phase !== 'ended' };
}

const stats = { games: 0, draw: 0, stuck: 0, wins: {}, fans: [], zimo: 0, ron: 0, totalSteps: 0, big: 0 };
const bump = (k) => { stats.wins[k] = (stats.wins[k] || 0) + 1; };

for (let i = 0; i < N; i++) {
  const { room, steps, stuck } = playOne(LEGACY ? legacyDecide : BOT.botDecide);
  stats.games++;
  stats.totalSteps += steps;
  if (stuck) { stats.stuck++; continue; }
  const w = room.winners;
  if (!w || w.draw) { stats.draw++; continue; }
  stats.fans.push(w.fan);
  if (w.zimo) stats.zimo++; else stats.ron++;
  const labels = w.labels || [];
  if (!labels.length) bump('（无奖励：普通自摸/平胡）');
  for (const l of labels) bump(l);
  if (labels.some((l) => /清一色|混一色|金龙|金雀|三金倒|对对胡/.test(l))) stats.big++;
}

const avg = (a) => (a.length ? (a.reduce((x, y) => x + y, 0) / a.length).toFixed(2) : '0');
console.log(`\n===== ${LEGACY ? '旧版 AI' : '新版（做大牌）AI'} · ${stats.games} 局 =====`);
console.log(`流局 ${stats.draw}  卡死 ${stats.stuck}  自摸 ${stats.zimo}  点炮+抢金/抢杠 ${stats.ron}`);
console.log(`大牌胡占比 ${((stats.big / Math.max(1, stats.games - stats.draw - stats.stuck)) * 100).toFixed(1)}%  平均片数 ${avg(stats.fans)}  平均步数 ${(stats.totalSteps / stats.games).toFixed(1)}`);
console.log('牌型分布：');
for (const [k, v] of Object.entries(stats.wins).sort((a, b) => b[1] - a[1])) {
  console.log(`  ${k.padEnd(18, ' ')} ${v}`);
}
