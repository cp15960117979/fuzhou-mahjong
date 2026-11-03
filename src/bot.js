/**
 * 大乱斗机器人 AI —— 做大牌 / 防大牌
 * ============================================================
 * 这个游戏的分几乎全在大牌上（清一色 48 / 混一色 24 / 金龙 24 / 金雀 12 / 三金倒 10，
 * 普通自摸只有几片），所以机器人不按"最快胡"打，而是先定这一手最值得做哪个大牌（plan），
 * 再围绕计划取舍；同时盯住别人的大牌，别把牌打到他手里去。
 *
 * 计划优先级（与玩家定下的口径一致）：
 * 1) 一门数牌 12 张以上            → 必做清/混一色
 * 2) 一门 10 张以上且手里有金       → 必做清/混一色
 * 3) 手里 3 张金                    → 先试金龙；要再吃碰 3 手以上才成，就放弃、直接三金倒
 * 4) 手里 2 张金                    → 先看能不能清/混一色；不行再看金雀 / 对子多就对对胡
 * 5) 抢金                          → 自己清/混一色有戏就不抢，没戏就抢
 * 6) 防守                          → 有人报听清/混一色就不打那门（除非现物 / 四张全见 /
 *                                     打完自己也进清混听牌，可以搏）
 *
 * 其它：金永不主动打；听牌后不拆听去碰；对对胡不吃；金龙最多吃碰 2 手。
 */
const MJ = require('./mahjong.js');

const SUIT_TXT = ['万', '条', '筒'];
const sidx = (t) => (t < 9 ? 0 : t < 18 ? 1 : 2);
const isNum = (t) => typeof t === 'number' && t >= 0 && t < 27;

// ---------- 基础统计 ----------
function split(hand, joker) {
  const counts = new Array(27).fill(0);
  let jokers = 0;
  for (const t of hand) {
    if (!isNum(t)) continue;
    if (t === joker) jokers++;
    else counts[t]++;
  }
  return { counts, jokers };
}

// 已成面子 / 对子 / 搭子 / 孤张（不含金；金是百搭，单独算）
function shapeStat(counts) {
  const c = counts.slice();
  let sets = 0;
  for (let i = 0; i < 27; i++) {
    while (c[i] >= 3) { c[i] -= 3; sets++; }
    if (i % 9 <= 6) {
      while (c[i] >= 1 && c[i + 1] >= 1 && c[i + 2] >= 1) { c[i]--; c[i + 1]--; c[i + 2]--; sets++; }
    }
  }
  let pairs = 0;
  for (let i = 0; i < 27; i++) if (c[i] >= 2) { pairs++; c[i] -= 2; }
  let tats = 0;
  for (let i = 0; i < 27; i++) {
    while (c[i] >= 1) {
      if (i % 9 <= 7 && c[i + 1] >= 1) { tats++; c[i]--; c[i + 1]--; }
      else if (i % 9 <= 6 && c[i + 2] >= 1) { tats++; c[i]--; c[i + 2]--; }
      else break;
    }
  }
  let singles = 0;
  for (let i = 0; i < 27; i++) singles += c[i];
  return { sets, pairs, tats, singles };
}

// 三门的张数（含已亮明子；金/花不算）
function suitCounts(p, joker) {
  const sc = [0, 0, 0];
  for (const t of p.hand) if (isNum(t) && t !== joker) sc[sidx(t)]++;
  for (const m of p.melds) for (const t of m.tiles) if (isNum(t) && t !== joker) sc[sidx(t)]++;
  return sc;
}

function rankCount(counts, need) {
  let n = 0;
  for (let i = 0; i < 27; i++) if (counts[i] >= need) n++;
  return n;
}

// 手牌里金的张数
function jokerCount(p, joker) {
  let n = 0;
  for (const t of p.hand) if (t === joker) n++;
  return n;
}

function meldTiles(p) {
  const out = [];
  for (const m of p.melds) for (const t of m.tiles) if (isNum(t)) out.push(t);
  return out;
}

function fullAfterDiscard(room, p, restHand) {
  return restHand.concat(meldTiles(p)); // 花牌不影响听牌判定
}

function oneSuit(tiles, joker) {
  const s = new Set();
  for (const t of tiles) {
    if (!isNum(t) || t === joker) continue;
    s.add(sidx(t));
    if (s.size > 1) return false;
  }
  return s.size <= 1;
}

// ---------- 计划选择 ----------
function choosePlan(room, p) {
  const joker = room.joker;
  const { counts, jokers } = split(p.hand, joker);
  const sc = suitCounts(p, joker);
  let dom = 0;
  if (sc[1] > sc[dom]) dom = 1;
  if (sc[2] > sc[dom]) dom = 2;
  const domCnt = sc[dom];
  const st = shapeStat(counts);
  const melds = p.melds.length;
  const totalSets = st.sets + melds;   // 副露也是面子，不能只数手牌
  const wall = room.wall.length;

  // 1) 三金：金龙 or 三金倒
  if (jokers >= 3) {
    // 金龙 = 3 金成刻 + 4 面子 + 将。还差几手要靠吃碰/摸补？
    const needExternal = 4 - totalSets;
    const canPair = st.pairs >= 1 || st.tats >= 1;
    if (needExternal <= 2 && canPair && wall >= 24) {
      return { kind: 'jinlong', suit: dom, jokers, domCnt, needExternal, reason: '三金：金龙有戏' };
    }
    return { kind: 'sanjindao', suit: dom, jokers, domCnt, needExternal, reason: '三金：金龙成本太高→三金倒' };
  }

  // 2) 一门 12 张以上 → 必做清/混一色
  if (domCnt >= 12) {
    return { kind: 'qinghun', suit: dom, jokers, domCnt, force: true, reason: `${SUIT_TXT[dom]}已 ${domCnt} 张` };
  }
  // 3) 一门 10 张以上且有金 → 必做清/混一色
  if (domCnt >= 10 && jokers >= 1) {
    return { kind: 'qinghun', suit: dom, jokers, domCnt, force: true, reason: `${SUIT_TXT[dom]} ${domCnt} 张 + 金 ${jokers}` };
  }
  // 3.5) 杂色只剩一两张 + 有金 → 清一色只差临门一脚（48 片 vs 金雀 12 片），别退回去打小牌
  const offCnt = sc[0] + sc[1] + sc[2] - domCnt;
  if (jokers >= 1 && offCnt <= 2 && domCnt >= 9) {
    return { kind: 'qinghun', suit: dom, jokers, domCnt, force: true, reason: `${SUIT_TXT[dom]} ${domCnt} 张，杂色仅 ${offCnt} 张` };
  }

  // 4) 两个金：先清混，再金雀 / 对对胡
  if (jokers >= 2) {
    if (domCnt >= 10) {
      return { kind: 'qinghun', suit: dom, jokers, domCnt, force: true, reason: `${SUIT_TXT[dom]} ${domCnt} 张 + 双金` };
    }
    const ke = rankCount(counts, 3);
    const pr = rankCount(counts, 2);
    const pengMelds = p.melds.filter((m) => m.type !== 'chi').length;
    const hasChi = p.melds.some((m) => m.type === 'chi');
    const jinqueFit = totalSets + st.pairs + st.tats;  // 15 张数牌要凑 5 面子
    const duiziFit = ke + pr + pengMelds;              // 5 刻 + 将（吃过就做不成）
    if (!hasChi && (pr >= 4 || (duiziFit >= 5 && jinqueFit < 5))) {
      return { kind: 'duizi', suit: dom, jokers, domCnt, reason: `双金 + 对子多（${pr} 对）` };
    }
    return { kind: 'jinque', suit: dom, jokers, domCnt, reason: '双金：金雀' };
  }

  // 5) 0-1 金：不硬做，跟着主花色走（软性偏好）
  return { kind: 'normal', suit: dom, jokers, domCnt, soft: domCnt >= 8, reason: '常规' };
}

// 小胡就在手上，但大牌只差一两步 → 值不值得忍一手？
// 参照：普通自摸约 2-4 片/家；清一色 48、混一色 24、金雀 12、对对胡 8-12 都是单家奖励。
function shouldChaseBig(room, p, plan) {
  if (room.wall.length < 16) return false;      // 牌墙见底就别赌了
  if (p.jinKan) return false;
  const { counts, jokers } = split(p.hand, room.joker);
  const sc = suitCounts(p, room.joker);
  const off = sc[0] + sc[1] + sc[2] - Math.max(sc[0], sc[1], sc[2]);
  const st = shapeStat(counts);
  const totalSets = st.sets + p.melds.length;
  if (plan.kind === 'qinghun') {
    // 只差几张杂色就纯了 → 值得；差 6 张以上就认小胡
    return off <= 3 || (plan.domCnt >= 12 && off <= 5);
  }
  if (plan.kind === 'jinque') {
    return jokers >= 2 && totalSets + st.pairs + st.tats >= 5;
  }
  if (plan.kind === 'duizi') {
    const pengMelds = p.melds.filter((m) => m.type !== 'chi').length;
    return jokers >= 1 && rankCount(counts, 3) + rankCount(counts, 2) + pengMelds >= 5;
  }
  if (plan.kind === 'jinlong') return plan.needExternal <= 2;
  return false;
}

// ---------- 出牌评估 ----------
function evalHand(hand, joker) {
  const { counts, jokers } = MJ.separateJokers(hand, joker);
  let s = jokers * 3;
  if (MJ.isTing(hand, joker)) s += 100;
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

// 某家在做什么花色（报听清/混一色 → 那门；没报听但有 3 手同门明子 → 疑似）
function dangerSuitOf(room, o) {
  if (o.jinKan) return -1; // 金坎只自摸，打什么都不会点炮
  const s = new Set();
  for (const m of o.melds) for (const t of m.tiles) {
    if (!isNum(t) || t === room.joker) continue;
    s.add(sidx(t));
  }
  if (s.size !== 1) return -1;
  const suit = [...s][0];
  if (o.declaredTing) return suit;          // 明确报听清/混一色
  if (o.melds.length >= 3) return suit;      // 3 手同门，基本就在做清混
  return -1;
}

// 这张牌对某家是不是"现物/死牌"
function isSafeTile(room, p, o, tile) {
  if (o.discards.includes(tile)) return true; // 他打过 → 当现物
  let seen = 0;
  for (const pl of room.players) {
    for (const x of pl.discards) if (x === tile) seen++;
    for (const m of pl.melds) for (const x of m.tiles) if (x === tile) seen++;
  }
  for (const x of p.hand) if (x === tile) seen++;
  if (tile === room.joker) seen += 1; // 公共展示的那一张
  return seen >= 4;                    // 四张全见 → 谁也胡不了
}

// 这张牌打出去会不会喂到别人的清/混一色
function isDangerous(room, p, tile, rest, plan) {
  const joker = room.joker;
  const suit = sidx(tile);
  for (const o of room.players) {
    if (o.seat === p.seat) continue;
    const ds = dangerSuitOf(room, o);
    if (ds < 0 || ds !== suit) continue;
    if (!o.declaredTing) continue;        // 只是疑似，下面单独给软惩罚
    if (isSafeTile(room, p, o, tile)) continue;
    // 搏一搏：打完自己就进清/混一色听牌
    const full = fullAfterDiscard(room, p, rest);
    if (oneSuit(full, joker) && MJ.isTingEx(rest, p.melds, joker)) continue;
    return true;
  }
  return false;
}

// 疑似（没报听但明子全同门）→ 软惩罚
function softDanger(room, p, tile) {
  const suit = sidx(tile);
  for (const o of room.players) {
    if (o.seat === p.seat || o.declaredTing) continue;
    const ds = dangerSuitOf(room, o);
    if (ds === suit && o.melds.length >= 3) return true;
  }
  return false;
}

// ---------- 出牌 ----------
function pickDiscard(room, p, plan) {
  const joker = room.joker;
  const hand = p.hand;
  const uniq = [...new Set(hand)];
  const NOJ = uniq.filter((t) => t !== joker);
  const pool = NOJ.length ? NOJ : uniq;
  const planSuit = plan ? plan.suit : -1;
  const total = hand.length;
  let best = pool[0], bestScore = -Infinity;

  for (const t of pool) {
    const rest = hand.slice();
    rest.splice(rest.indexOf(t), 1);
    let sc = evalHand(rest, joker);
    const cnt = hand.filter((x) => x === t).length;
    const s = sidx(t);

    if (plan) {
      switch (plan.kind) {
        case 'qinghun':
          // 要一门：非本门一律先走，本门绝不轻易拆
          sc += (s === planSuit ? -80 : 80);
          if (s !== planSuit && cnt >= 3) sc -= 10; // 非本门的刻子也不心疼，只是稍慢
          break;
        case 'duizi':
          // 对对胡：只留对子/刻子，孤张先走
          sc += cnt >= 3 ? -45 : cnt === 2 ? -16 : 12;
          break;
        case 'jinque':
          // 金雀：15 张数牌自成 5 面子，刻子 > 顺子搭子 > 对子，孤张先走
          sc += cnt >= 3 ? -30 : cnt === 2 ? -4 : 10;
          if (s === planSuit) sc += 3;
          break;
        case 'jinlong':
          // 金龙：金当刻，剩下的要 4 面子 + 将
          sc += cnt >= 3 ? -45 : cnt === 2 ? -20 : 14;
          break;
        default:
          if (plan.soft && s === planSuit) sc -= 6; // 常规也尽量跟主花色
          break;
      }
    }

    if (isDangerous(room, p, t, rest, plan)) sc -= 1000;
    // 只是"疑似在做清混"还没报听 → 该冲就冲（自己也在清一色时更不能怂，退一步就永远追不上）
    else if (softDanger(room, p, t) && !(plan && plan.force)) sc -= 25;

    sc += Math.random() * 0.05; // 破平局
    if (sc > bestScore) { bestScore = sc; best = t; }
  }
  // 兜底：真打不出去就随便打一张非金
  if (best == null || !hand.includes(best)) best = NOJ[0] != null ? NOJ[0] : hand[0];
  return best;
}

// ---------- 吃碰杠的判断 ----------
function shouldPeng(room, p, tile, plan, ting) {
  if (ting) return false;                          // 已听牌不拆听
  if (p.melds.length >= 5) return false;
  if (plan.kind === 'qinghun') return sidx(tile) === plan.suit;
  if (plan.kind === 'jinlong') return p.melds.length < 2; // 金龙最多吃碰 2 手
  if (plan.kind === 'jinque') return true;
  if (plan.kind === 'duizi') return true;          // 碰是对对胡最好的补牌
  return true;
}

function shouldChi(room, p, tile, plan, ting) {
  if (ting) return false;
  if (p.melds.length >= 5) return false;
  if (plan.kind === 'qinghun') return sidx(tile) === plan.suit;
  if (plan.kind === 'duizi') return false;         // 吃一手就永远做不成对对胡
  if (plan.kind === 'jinlong') return p.melds.length < 2;
  return true;
}

// 这张数牌同门、±2 以内的邻牌（去掉自己）
function nearRanks(tile) {
  const r = tile % 9, base = tile - r, out = [];
  for (let d = -2; d <= 2; d++) {
    const x = r + d;
    if (d === 0 || x < 0 || x > 8) continue;
    out.push(base + x);
  }
  return out;
}

// 这张牌还有几张没露面（牌墙/别人手里可能还有）
function unseenCount(room, p, t) {
  let seen = 0;
  for (const pl of room.players) {
    for (const x of pl.discards) if (x === t) seen++;
    for (const m of pl.melds) for (const x of m.tiles) if (x === t) seen++;
  }
  for (const x of p.hand) if (x === t) seen++;
  if (t === room.joker) seen++; // 公共亮出的那张金
  return Math.max(0, 4 - seen);
}

// "断章"：这门里 ±2 以内全见了，留着也靠不上任何顺子
function isDeadTile(room, p, tile) {
  if (!isNum(tile) || tile === room.joker) return false;
  for (const t of nearRanks(tile)) if (unseenCount(room, p, t) > 0) return false;
  return true;
}

function shouldGang(room, p, tile, plan, ting) {
  if (ting) return false;
  if (plan.kind === 'qinghun' && sidx(tile) !== plan.suit) return false; // 杠别门会毁清一色
  // 做清/混一色时杠是"把活牌变死牌"：手里 5555 万留着能靠 3、6 万，
  // 杠掉就只剩一个固定刻子。所以默认不杠，只有"断章 + 整手已统一花色"才杠（那时杠只加分不损搭子）。
  if (plan.kind === 'qinghun' || plan.kind === 'jinlong') {
    if (!isDeadTile(room, p, tile)) return false;
    if (!oneSuit(room.fullTiles(p), room.joker)) return false;
    return true;
  }
  return true;
}

// 吃哪一手：选吃完之后手牌潜力最大的
function chooseChi(room, p, combos, plan) {
  if (!combos || !combos.length) return null;
  const joker = room.joker;
  let best = combos[0], bs = -Infinity;
  for (const c of combos) {
    const rest = p.hand.slice();
    let ok = true;
    for (const t of c) {
      const i = rest.indexOf(t);
      if (i < 0) { ok = false; break; }
      rest.splice(i, 1);
    }
    if (!ok) continue;
    let sc = evalHand(rest, joker);
    if (plan.kind === 'duizi') sc -= 100;
    if (plan.kind === 'qinghun' && sidx(c[0]) !== plan.suit) sc -= 100;
    if (sc > bs) { bs = sc; best = c; }
  }
  return best;
}

// ---------- 换牌 ----------
// 换牌是"给出某门 3 张、收进上家给的那门 3 张"，收什么不可控 →
// 给掉自己最弱的一门（张数最少、最没搭子的那门），把主花色留住。
function pickSwap(room, p) {
  const cnt = { m: 0, s: 0, p: 0 };
  for (const t of p.hand) { const s = MJ.suitOf(t); if (cnt[s] != null) cnt[s]++; }
  const opts = ['m', 's', 'p'].filter((s) => cnt[s] >= 3);
  if (!opts.length) return null;
  const { counts } = split(p.hand, room.joker);
  // 评分：门内张数越少越好（保住主花色）；同门张数时，门内孤张越多越该换
  let best = opts[0], bestSc = -Infinity;
  for (const s of opts) {
    const si = { m: 0, s: 1, p: 2 }[s];
    let inSuit = 0, linked = 0;
    for (let r = 0; r < 9; r++) {
      const t = si * 9 + r;
      if (!counts[t]) continue;
      inSuit += counts[t];
      if ((r <= 7 && counts[t + 1]) || (r >= 1 && counts[t - 1])) linked += counts[t];
    }
    let sc = -inSuit * 2 + (inSuit - linked) * 0.6;
    if (inSuit >= 12) sc -= 100; // 12 张以上这门是命根子，绝不给
    sc += Math.random() * 0.3;
    if (sc > bestSc) { bestSc = sc; best = s; }
  }
  // 从这门里挑最孤的 3 张给出去
  // 上一轮四家撞了同一门（无效重摇）→ 这次换一门，避免全机器人反复选同一门卡住
  if (room.swapFail > 0 && opts.length > 1) best = opts[room.swapFail % opts.length];
  const si = { m: 0, s: 1, p: 2 }[best];
  const tiles = p.hand.filter((t) => MJ.suitOf(t) === best);
  tiles.sort((a, b) => conn(a, counts) - conn(b, counts));
  return { suit: best, tiles: tiles.slice(0, 3) };
}

function conn(t, counts) {
  const r = t % 9;
  let n = 0;
  if (r >= 1 && counts[t - 1]) n += 2;
  if (r <= 7 && counts[t + 1]) n += 2;
  if (r >= 2 && counts[t - 2]) n += 1;
  if (r <= 6 && counts[t + 2]) n += 1;
  if (counts[t] >= 2) n += 3;
  return n;
}

// ---------- 主入口 ----------
function botDecide(room, seat) {
  const p = room.getPlayer(seat);
  if (!p || !p.isBot) return;
  if (room.phase !== 'playing' && room.phase !== 'swap') return;
  const st = room.getState(seat);
  const acts = st.actions || [];
  // 机器人被重复调度时会拿到"已响应/无可响应"这类无害回执，不要刷到玩家日志里
  const QUIET = ['已响应', '当前无可响应操作', '你无需响应'];
  const done = (res) => {
    if (res && !res.ok && !QUIET.includes(res.msg)) room.log.push(`[bot${seat}] ${res.msg || '操作失败'}`);
  };

  // 0) 换牌：给最弱的一门
  if (st.phase === 'swap' && acts.includes('swap:chooseSuit')) {
    const pick = pickSwap(room, p);
    if (pick) done(room.doSwap(seat, pick.suit, pick.tiles));
    return;
  }

  const plan = choosePlan(room, p);
  p.botPlan = plan; // 便于调试/复盘

  // 1) 能胡：先看值不值得胡（抢金 / 三金倒 两处会让牌）
  if (acts.includes('hu')) {
    const pend = st.pending;
    // 抢金 = 拿开局公示金胡（与庄家打出的那张无关），要按"这手带不带大牌奖励"决定抢不抢
    const isQiangjin = !!pend && pend.qiangjin === true && pend.kind !== 'qianggang'
      && (typeof room.canQiangjin !== 'function' || room.canQiangjin(p));
    if (isQiangjin) {
      // 这手本身就带大牌奖励 → 当然抢；只有"抢个空金"才让
      const wonLabels = room.labelsOf(p, [room.joker], { qiangjin: true });
      if (!wonLabels.length && plan.kind === 'qinghun' && plan.force) {
        room.log.push(`${p.name} 放弃抢金（${plan.reason}，改做清/混一色）`);
        done(room.claim(seat, 'pass'));
        return;
      }
    }
    if (!pend) {
      // 天胡：开局第一手就成牌（三金倒不算天胡），没有"忍一手做大牌"的余地 → 直接倒
      if (typeof room.isTianHuWin === 'function' && room.isTianHuWin(p)) {
        room.log.push(`${p.name} 天胡！开局第一手成牌`);
        const tr = room.selfHu(seat);
        if (tr && tr.ok) return;
      }
      const r = room.checkWinOf(p);
      const bigNow = r.feats && (r.feats.jinlong || r.feats.jinque || r.feats.qingyise ||
        r.feats.hunyise || r.feats.youjinDuizi || r.feats.wujinDuizi);
      const plain = !bigNow && p.flowerCount > 0; // 普通自摸（没大牌奖励，也不到 0 花）
      const sw = p.skipWin && p.skipWin.round === room.roundNo
        ? p.skipWin : (p.skipWin = { round: room.roundNo, n: 0 });
      if (plan.kind === 'jinlong' && r.win && !bigNow) {
        // 手里 3 金，金龙还有戏 → 先不胡三金倒，接着做金龙
        room.log.push(`${p.name} 暂缓三金倒（${plan.reason}）`);
      } else if (plain && sw.n < 2 && shouldChaseBig(room, p, plan)) {
        // 小胡没什么分，大牌就在眼前 → 忍一手，继续做大牌
        sw.n++;
        room.log.push(`${p.name} 忍住小胡，继续做${plan.kind === 'qinghun' ? '清/混一色' : plan.kind === 'jinque' ? '金雀' : plan.kind === 'duizi' ? '对对胡' : '大牌'}`);
      } else {
        const hr = room.selfHu(seat);
        if (hr && hr.ok) return;
        done(hr); // 自摸判定失败 → 继续走下面的出牌逻辑，别卡死
      }
    } else {
      const hr = room.claim(seat, 'hu');
      if (hr && hr.ok) return;
      done(hr);
      // 胡不了就 pass 掉，别死循环重试
      done(room.claim(seat, 'pass'));
      return;
    }
  }

  // 2) 自己回合：金坎 / 报听 / 杠 / 出牌
  if (acts.includes('jinkan')) {
    const r0 = room.declareJinKan(seat);
    if (r0 && r0.ok) return; // 宣告失败就继续正常出牌，避免卡住
  }
  if (acts.includes('ting')) {
    const tr = room.declareTing(seat);
    done(tr);
    if (tr && tr.ok) return; // 报听失败就继续正常出牌
  }

  const ting = room.isTingOf(p);
  const ag = acts.find((a) => typeof a === 'string' && a.startsWith('angang:'));
  if (ag) {
    const t = Number(ag.split(':')[1]);
    if (!ting && shouldGang(room, p, t, plan, ting)) { done(room.anGang(seat, t)); return; }
  }
  const bg = acts.find((a) => typeof a === 'string' && a.startsWith('bugang:'));
  if (bg) {
    const t = Number(bg.split(':')[1]);
    if (!ting && shouldGang(room, p, t, plan, ting)) { done(room.buGang(seat, t)); return; }
  }
  if (acts.includes('discard') && p.isCurrent !== false) {
    const t = pickDiscard(room, p, plan);
    const res = room.discard(seat, t);
    if (res && !res.ok) {
      // 兜底：换一张非金打
      const alt = p.hand.find((x) => x !== room.joker);
      if (alt != null) done(room.discard(seat, alt));
    }
    return;
  }

  // 3) 响应他家出牌
  if (st.pending && st.pending.seats.includes(seat)) {
    const kind = st.pending.kind;
    if (kind === 'qianggang') { done(room.claim(seat, 'pass')); return; }
    if (ting) { done(room.claim(seat, 'pass')); return; } // 已听牌：不拆听

    const tile = st.pending.tile;
    const gangAct = acts.includes('gang');
    const pengAct = acts.includes('peng');
    const chiAct = acts.find((a) => a && a.act === 'chi');

    if (gangAct && shouldGang(room, p, tile, plan, ting)) { done(room.claim(seat, 'gang')); return; }
    if (pengAct && shouldPeng(room, p, tile, plan, ting)) { done(room.claim(seat, 'peng')); return; }
    if (chiAct && chiAct.combos && chiAct.combos.length && shouldChi(room, p, tile, plan, ting)) {
      const combo = chooseChi(room, p, chiAct.combos, plan);
      if (combo) { done(room.claim(seat, 'chi', { combo })); return; }
    }
    done(room.claim(seat, 'pass'));
  }
}

module.exports = {
  botDecide, evalHand, pickDiscard, choosePlan, pickSwap,
  shouldPeng, shouldChi, shouldGang, dangerSuitOf, isSafeTile, shapeStat,
  isDeadTile, unseenCount, nearRanks, shouldChaseBig, isDangerous,
};
