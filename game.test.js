/**
 * 大乱斗状态机测试（含完整自动对局 + 计分校验）
 */
const assert = require('assert');
const { Room } = require('../src/game.js');
const MJ = require('../src/mahjong.js');

function mockPlayer(name) {
  return { send() {}, readyState: 1, name };
}

function newRoom() {
  const r = new Room('T');
  for (let i = 0; i < 4; i++) r.addPlayer(mockPlayer('P' + i), 'P' + i);
  return r;
}

// 选一个有 >=3 张的花色（随机，避免四人全同导致无限重洗）
function chooseSwapSuit(r, seat) {
  const p = r.getPlayer(seat);
  const cnt = { m: 0, s: 0, p: 0 };
  for (const t of p.hand) cnt[MJ.suitOf(t)]++;
  const opts = ['m', 's', 'p'].filter((s) => cnt[s] >= 3);
  if (opts.length === 0) return 'm';
  return opts[Math.floor(Math.random() * opts.length)];
}

// 自动推进一局，返回是否结束
function autoPlay(r, maxTurns = 6000) {
  let guard = 0;
  while (r.phase !== 'ended' && guard++ < maxTurns) {
    let advanced = false;
    for (const p of r.players) {
      const st = r.getState(p.seat);
      if (st.phase === 'swap' && st.actions.includes('swap:chooseSuit')) {
        r.doSwap(p.seat, chooseSwapSuit(r, p.seat)); advanced = true; continue;
      }
      if (st.actions.includes('hu')) {
        // 与服务端一致: 有 pending 走 claim, 无 pending(自家回合自摸/金坎胡)走 selfHu
        const res = st.pending ? r.claim(p.seat, 'hu') : r.selfHu(p.seat);
        if (!res || res.ok) { advanced = true; continue; }
        // 胡失败(理论少见) → 落到后续分支继续推进
      }
      if (st.actions.includes('discard')) {
        const self = r.getPlayer(p.seat);
        r.discard(p.seat, self.hand[0]); advanced = true; continue;
      }
      // 待响应（非自己回合）：有动作则响应，否则过
      if (st.pending && st.pending.seats.includes(p.seat)) {
        const act = st.actions.find((a) => a !== 'pass');
        r.claim(p.seat, act && act.act ? act.act : 'pass'); advanced = true;
      }
    }
    if (!advanced && r.phase !== 'ended') break; // 防死循环
  }
  return r.phase === 'ended';
}

// ---------- 1. 整局自动跑通，结算结构正确 ----------
(function testFullGame() {
  const r = newRoom();
  const res = r.startGame();
  assert(res.ok, 'startGame 应成功');
  assert(r.phase === 'swap' || r.phase === 'playing', '开局进入换牌或游戏');
  const ended = autoPlay(r);
  assert(ended, '整局应跑到结束');
  assert(r.winners, '应有 winners');
  assert(r.winners.draw || (r.winners.seats && r.winners.payers), 'winners 结构完整');
  if (!r.winners.draw) {
    const totalPaid = r.winners.payers.reduce((s, x) => s + x.amount, 0);
    // 大乱斗：任何胡（自摸/点炮）都是三家各付全额，赢家收 3×片
    const expected = 3 * r.winners.fan;
    assert(Math.abs(totalPaid - expected) < 0.001, `支付总额应=${expected}, 实=${totalPaid}`);
  }
  console.log('✓ 整局自动跑通 + 结算校验');
})();

// ---------- 2. 计分：自摸金雀 6花2金 → 16 片（金雀必须自摸） ----------
(function testScoreJinque() {
  const r = newRoom();
  r.startGame();
  let safety = 0;
  while (r.phase === 'swap' && safety++ < 80) { for (const p of r.players) if (r.swap.choices[p.seat] == null) r.doSwap(p.seat, chooseSwapSuit(r, p.seat)); }
  assert(r.phase === 'playing' && r.joker >= 0, '应进入游戏且已开金');
  r.lianZhuang = 0; // 清零避免换牌重洗污染
  r.opening = false;
  const J = r.joker;
  const w = r.getPlayer(0);
  // 16 张制：2 金作将 + 5 组面子，共 17 张（自摸）
  // 用"不含金"的两门花色，避免手牌里的牌被当成金
  const ranges = [[0, 8], [9, 17], [18, 26]];
  const js = Math.floor(J / 9);
  const [A, B] = ranges.filter((_, i) => i !== js).map((rg) => rg[0]);
  w.hand = [J, J, A, A+1, A+2, A+3, A+4, A+5, A+6, A+7, A+8, B, B+1, B+2, B+3, B+4, B+5];
  w.flowerCount = 6; w.melds = [];
  const res = r.doHu(0, true, 0, {});
  assert(res.ok, '金雀自摸胡应成立: ' + JSON.stringify(res));
  const wn = r.winners;
  // 非0花：花6+金2=8朵 ×2=16 → 4片；+金雀12 = 16片；三家各付16，赢家收48
  assert(wn.fan === 16, `金雀应16片, 实=${wn.fan} (${wn.summary})`);
  assert(wn.detail.includes('金雀（12）'), '应含金雀奖励');
  assert(wn.detail.some((d) => d.includes('金（2）')), '非0花: 金应计入基础朵');
  const total = wn.payers.reduce((s, x) => s + x.amount, 0);
  assert(total === 3 * wn.fan, `三家应付总额应=3×16=48, 实=${total}`);
  console.log('✓ 计分：自摸金雀 6花2金 = 16 片 (', wn.summary, ')');
})();

// ---------- 3. 换牌环：四人全换，全同花色 → 无效重摇（不涨连庄） ----------
(function testSwapRing() {
  const r = newRoom();
  r.startGame();
  assert(r.phase === 'swap', '应进入换牌');
  const before = r.lianZhuang;
  // 强制每人手牌含 3 张万，全员选万 → 必然全同 → 无效重摇
  for (const p of r.players) {
    let put = 0;
    for (let i = 0; i < p.hand.length && put < 3; i++) {
      if (p.hand[i] !== 0) { p.hand[i] = 0; put++; }
    }
  }
  for (const p of r.players) {
    const res = r.doSwap(p.seat, 'm');
    assert(res.ok, '全员换万应成功受理');
  }
  assert(r.phase === 'playing' || r.phase === 'swap', '换牌后应 playing 或重洗');
  if (r.phase === 'swap') {
    assert(r.lianZhuang === before, '换牌无效重摇不涨连庄（连庄只由庄家胡/流局产生）');
    assert(r.swapFail >= 1, '应记一次换牌无效并重摇骰子');
  }
  console.log('✓ 换牌环执行 + 重洗连庄逻辑');
})();

// ---------- 4. 连庄累计计分（非大牌自摸） ----------
(function testLianZhuang() {
  const r = newRoom();
  r.startGame();
  let safety = 0;
  while (r.phase === 'swap' && safety++ < 80) { for (const p of r.players) if (r.swap.choices[p.seat] == null) r.doSwap(p.seat, chooseSwapSuit(r, p.seat)); }
  assert(r.phase === 'playing' && r.joker >= 0, '应进入游戏且已开金');
  r.lianZhuang = 2; // 已连庄2次
  r.opening = false;
  const w = r.getPlayer(r.dealer);
  // 构造普通胡（两门花色、无金、无番）：A门三组顺 + B门一组顺 + B门对将 (避免手牌撞金)
  const ranges = [[0, 8], [9, 17], [18, 26]];
  const js = Math.floor(r.joker / 9);
  const [A, B] = ranges.filter((_, i) => i !== js).map((rg) => rg[0]);
  w.hand = [A, A+1, A+2, A+3, A+4, A+5, A+6, A+7, A+8, B, B+1, B+2, B+3, B+4, B+5, B+6, B+6];
  w.melds = []; w.flowerCount = 11;
  // 非大牌自摸: (11花+0金+连庄2)*2 再+1(自摸) = (13+1)*2=28 → 6片
  const res = r.doHu(r.dealer, true, r.dealer, {});
  assert(res.ok, '庄自摸应成立');
  assert(r.winners.fan === 6, `应6片, 实=${r.winners.fan} (${r.winners.summary})`);
  console.log('✓ 连庄计分：11花连庄2 非大牌自摸 = 6 片 (', r.winners.summary, ')');
})();

// ---------- 4b. 三金倒：3金+无花胡8+三金倒10 = 21片/家，三家各付21，赢家收63 ----------
// 构造"不含金、且确定判为三金倒(非金龙)"的 11 张其他牌：三门孤立单张 + 2 张增补，避开金值
function genSanJinDaoOthers(J) {
  const pool = [];
  for (let t = 0; t < 27; t++) if (t !== J) pool.push(t);
  for (let trial = 0; trial < 200000; trial++) {
    const pick = [];
    while (pick.length < 14) {
      const t = pool[Math.floor(Math.random() * pool.length)];
      if (pick.filter((x) => x === t).length < 4) pick.push(t);
    }
    pick.sort((a, b) => a - b);
    const r = MJ.checkWin([J, J, J, ...pick], J);
    if (r.win && r.type === 'sanjindao') return pick;
  }
  return null;
}
(function testSanJinDao() {
  const r = newRoom();
  r.startGame();
  let safety = 0;
  while (r.phase === 'swap' && safety++ < 80) { for (const p of r.players) if (r.swap.choices[p.seat] == null) r.doSwap(p.seat, chooseSwapSuit(r, p.seat)); }
  assert(r.phase === 'playing' && r.joker >= 0, '应进入游戏且已开金');
  r.lianZhuang = 0; r.opening = false;
  const J = r.joker;
  const w = r.getPlayer(0);
  const others = genSanJinDaoOthers(J);
  assert(others, '应能构造三金倒手牌');
  // 三金倒只能自己回合倒：先验证"点炮不成立"
  //   16 张手牌 = 3 金 + 13 张；别人打出第 17 张 → 不能胡
  w.hand = [J, J, J, ...others.slice(0, 13)];
  w.flowerCount = 0; w.melds = [];
  r.lastDiscard = { tile: others[13], by: 1 }; // 座位1 放炮
  assert(!r.canRon(w, others[13], false), '三金倒不能点炮（别人打出不算）');
  const bad = r.doHu(0, false, 1, {});
  assert(!bad.ok, '三金倒点炮胡必须被拒绝');
  // 改回自摸：自己摸到第 3 张金（16 张手牌 + 刚摸到的金 = 17 张，摸牌即金）
  w.hand = [J, J, J, ...others.slice(0, 14)];
  w.lastDrawn = J;
  r.lastDiscard = null;
  const res = r.doHu(0, true, 0, {});
  assert(res.ok, '三金倒自摸胡应成立');
  const wn = r.winners;
  // 0花: 金每枚直接+1片(3) + 无花胡8 + 三金倒10 = 21片/家；三家各付21，赢家收63
  assert(wn.fan === 21, `三金倒应21片/家, 实=${wn.fan} (${wn.summary})`);
  assert(wn.detail.includes('三金倒（10）'), '应含三金倒奖励(10)');
  assert(wn.detail.includes('无花胡（8）'), '0花应计无花胡+8');
  assert(wn.detail.includes('金（3）= 3片'), '0花: 3枚金应各+1片');
  const total = wn.payers.reduce((s, x) => s + x.amount, 0);
  assert(total === 63 && wn.payers.length === 3 && wn.payers.every((p) => p.amount === 21), `三家各付21合计63, 实=${total} payers=${JSON.stringify(wn.payers)}`);
  console.log('✓ 三金倒：3金+无花胡8+三金倒10 = 21片/家，三家各付21，赢家收63 (', wn.summary, ')');
})();

// ---------- 4c. 点炮（非包牌）也应三家各付全额 ----------
(function testDianPaoThreeFamilies() {
  const r = newRoom();
  r.startGame();
  let safety = 0;
  while (r.phase === 'swap' && safety++ < 80) { for (const p of r.players) if (r.swap.choices[p.seat] == null) r.doSwap(p.seat, chooseSwapSuit(r, p.seat)); }
  assert(r.phase === 'playing' && r.joker >= 0, '应进入游戏且已开金');
  r.lianZhuang = 0; r.opening = false;
  const J = r.joker;
  const w = r.getPlayer(0);
  const ranges = [[0, 8], [9, 17], [18, 26]];
  const js = Math.floor(J / 9);
  const [A, B] = ranges.filter((_, i) => i !== js).map((rg) => rg[0]);
  // 无花胡（大牌，可点炮）：两门花色，16 张听牌（听 B+6 成将）
  w.hand = [A, A+1, A+2, A+3, A+4, A+5, A+6, A+7, A+8, B, B+1, B+2, B+3, B+4, B+5, B+6];
  w.melds = []; w.flowerCount = 0;
  r.lastDiscard = { tile: B + 6, by: 2 }; // 座位2 放炮，凑成 B+6 将
  const res = r.doHu(0, false, 2, {});
  assert(res.ok, '点炮普通胡应成立');
  const wn = r.winners;
  // 5花 → (5+0)*2=10 → 2片；非大牌点炮 → 三家各付2，合计6（不再是单给）
  const total = wn.payers.reduce((s, x) => s + x.amount, 0);
  assert(wn.payers.length === 3 && wn.payers.every((p) => p.amount === wn.fan), `点炮也三家各付全额, fan=${wn.fan} payers=${JSON.stringify(wn.payers)}`);
  assert(total === 3 * wn.fan, `点炮总额应=3×片=${3 * wn.fan}, 实=${total}`);
  console.log('✓ 点炮（非包牌）三家各付全额 (', wn.summary, ')');
})();

// ---------- 5. 机器人：1真人 + 3机器人 跑完整局 ----------
(function testBotGame() {
  const r = new Room('B');
  r.addPlayer(mockPlayer('真人'), '真人');
  assert(r.addBot().ok, '添加机器人1');
  assert(r.addBot().ok, '添加机器人2');
  assert(r.addBot().ok, '添加机器人3');
  assert(!r.addBot().ok, '满4人不能再加');
  assert(r.removeBot().ok && r.addBot().ok, '移除再加机器人');
  const bots = r.players.filter((p) => p.isBot);
  assert(bots.length === 3, '应有3个机器人');
  assert(r.startGame().ok, '1真人+3机器人应能开局');
  const { botDecide } = require('../src/bot.js');
  let guard = 0;
  while (r.phase !== 'ended' && guard++ < 8000) {
    let advanced = false;
    for (const p of r.players) {
      const st = r.getState(p.seat);
      const hasAct = (st.actions && st.actions.length > 0) || (st.pending && st.pending.seats.includes(p.seat));
      if (!hasAct) continue;
      if (p.isBot) { botDecide(r, p.seat); advanced = true; continue; }
      // 真人座位由简易脚本代打（仅测试用）
      if (st.phase === 'swap' && st.actions.includes('swap:chooseSuit')) {
        const cnt = { m: 0, s: 0, p: 0 };
        for (const t of p.hand) cnt[MJ.suitOf(t)]++;
        const opts = ['m', 's', 'p'].filter((s) => cnt[s] >= 3);
        r.doSwap(p.seat, opts[0] || 'm'); advanced = true; continue;
      }
      if (st.actions.includes('hu')) {
        const res = st.pending ? r.claim(p.seat, 'hu') : r.selfHu(p.seat);
        if (!res || res.ok) { advanced = true; continue; }
      }
      if (st.actions.includes('discard')) { r.discard(p.seat, p.hand[0]); advanced = true; continue; }
      if (st.pending && st.pending.seats.includes(p.seat)) { r.claim(p.seat, 'pass'); advanced = true; continue; }
    }
    if (!advanced && r.phase !== 'ended') break;
  }
  assert(r.phase === 'ended', '1真人+3机器人整局应跑到结束');
  assert(r.winners, '应有结算结果');
  console.log('✓ 机器人：1真人+3机器人跑完整局 (', r.winners.draw ? '流局' : r.winners.summary, ')');
})();

// 补花计数：一张花只能算一朵（四家花数 + 墙里的花 = 36）
(function testFlowerCount() {
  for (let k = 0; k < 5; k++) {
    const r = newRoom();
    r.startGame();
    const sum = r.players.reduce((s, p) => s + p.flowerCount, 0);
    const inHand = r.players.reduce((s, p) => s + p.hand.filter((t) => MJ.isFlower(t)).length, 0);
    const inWall = r.wall.filter((t) => MJ.isFlower(t)).length;
    assert.strictEqual(sum + inHand + inWall, 36, `花牌总数应为 36，实=${sum + inHand + inWall}`);
    assert.strictEqual(inHand, 0, '补花后手里不应残留花牌');
    const hands = r.players.reduce((s, p) => s + p.hand.length, 0);
    assert.strictEqual(hands, 65, '四家手牌共 65 张（庄家发牌就多 1 张）');
  }
  console.log('✓ 补花：每张花只计一朵（四家花数 + 墙里 = 36）');
})();

console.log('\n全部大乱斗状态机测试通过 ✅');
