/**
 * 副露边界专项：吃/碰/杠亮出去的牌是"定死的面子"，不能倒回手里重新组合。
 *
 * 现场（2026-10-31 用户截图）：机器人丙 碰了 九条×3，暗牌 2345条 + 456筒，
 * 自摸 一条 却被判"胡"——摊平后拼成 123条 + 456条 + 789条 + 99将，
 * 其中两张九条是从碰出去的副露里"借"回来的。实际暗牌根本没有将。
 */
const { Room } = require('../src/game.js');
const MJ = require('../src/mahjong.js');
const BOT = require('../src/bot.js');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) pass++;
  else { fail++; console.log('✗', msg, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function mkRoom(joker = 8) {
  const r = new Room('MELD');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.pending = null; r.winners = null;
  r.opening = false; r.jinKanActive = false; r.joker = joker; r.turn = 0; r.selfCanHu = false;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.flowerCount = 2; p.jinKan = false;
    p.declaredTing = false; p.lastDrawn = -1; p.eatPongCount = 0; p.providers = []; p.score = 0;
  });
  return r;
}

// 牌编码：0-8 万 / 9-17 条 / 18-26 筒；joker=8 表示"金 = 九万"
const B = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => 8 + n);   // 条 9..17
const T = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => 17 + n);  // 筒 18..26
const tiao = (n) => B[n - 1];
const tong = (n) => T[n - 1];

// ---------- 1. 截图那一手：碰九条 + 2345条 + 456筒 + 摸到一条 → 不能胡 ----------
{
  const r = mkRoom(8);
  const p = r.getPlayer(0);
  p.melds = [
    { type: 'chi', tiles: [tong(1), tong(2), tong(3)], from: 1 },
    { type: 'peng', tiles: [tiao(9), tiao(9), tiao(9)], from: 2 },  // 碰死
    { type: 'chi', tiles: [tiao(6), tiao(7), tiao(8)], from: 3 },
  ];
  p.hand = [tiao(1), tiao(2), tiao(3), tiao(4), tiao(5), tong(4), tong(5), tong(6)];
  p.lastDrawn = tiao(1);

  ok(r.fullTiles(p).length === 17, '（前提）整手 17 张', r.fullTiles(p).length);
  ok(MJ.checkWin(r.fullTiles(p), 8).win === true, '旧口径会误判成胡（摊平后借走碰出的两张九条当将）');
  ok(MJ.checkWinEx(p.hand, p.melds, 8).win === false, '新口径：副露不能拆 → 不能胡', MJ.checkWinEx(p.hand, p.melds, 8).win);
  ok(r.selfHu(0).ok === false, 'selfHu 直接拒绝', r.selfHu(0));
  ok(MJ.labelsOf(MJ.checkWinEx(p.hand, p.melds, 8)).length === 0, '不会给出任何牌型标签');
  // 摸牌前其实是听 五条（234 + 55 将 / 345 + 22 将），一张都不能错
  const before = [tiao(2), tiao(3), tiao(4), tiao(5), tong(4), tong(5), tong(6)];
  ok(MJ.isTingEx(before, p.melds, 8) === true, '（前提）摸牌前确实听牌');
  ok(MJ.checkWinEx(before.concat([tiao(5)]), p.melds, 8).win === true, '（前提）听的是五条');
  ok(MJ.checkWinEx(before.concat([tiao(1)]), p.melds, 8).win === false, '但摸到一条不算胡（以前摊平后借副露的九条当将）');
}

// ---------- 2. 同一副露、但暗牌真的成牌 → 要能胡 ----------
{
  const r = mkRoom(8);
  const p = r.getPlayer(0);
  p.melds = [{ type: 'peng', tiles: [tiao(9), tiao(9), tiao(9)], from: 2 }];
  // 暗牌 14 张：123条 + 678条 + 456筒 + 222筒 + 55筒将
  p.hand = [tiao(1), tiao(2), tiao(3), tiao(6), tiao(7), tiao(8),
    tong(4), tong(5), tong(6), tong(2), tong(2), tong(2), tong(5), tong(5)].sort((a, b) => a - b);
  ok(r.fullTiles(p).length === 17, '（前提）17 张', r.fullTiles(p).length);
  const res = r.selfHu(0);
  ok(res.ok === true, '副露之后暗牌自成 4 面子 + 将 → 正常自摸', res);
  ok(r.winners && r.winners.winner === 0, '正常结算');
}

// ---------- 3. 点炮口径同样认副露边界 ----------
{
  const r = mkRoom(8);
  const p = r.getPlayer(0);
  p.melds = [
    { type: 'chi', tiles: [tong(1), tong(2), tong(3)], from: 1 },
    { type: 'peng', tiles: [tiao(9), tiao(9), tiao(9)], from: 2 },
    { type: 'chi', tiles: [tiao(6), tiao(7), tiao(8)], from: 3 },
  ];
  p.hand = [tiao(2), tiao(3), tiao(4), tiao(5), tong(4), tong(5), tong(6)]; // 听牌前 7 张
  ok(MJ.checkWin(r.fullTiles(p).concat([tiao(1)]), 8).win === true, '（旧口径）别人打一条也算胡');
  ok(r.canRon(p, tiao(1), false) === false, '新口径：点炮也不给胡（暗牌没有将）');
  ok(r.getState(0).pending === null, '（前提）这里没开窗口，只看 canRon');
}

// ---------- 4. 对对胡必须"副露全是碰/杠"，吃过的不能算 ----------
{
  const melds = [
    { type: 'peng', tiles: [tiao(9), tiao(9), tiao(9)] },
    { type: 'peng', tiles: [tiao(5), tiao(5), tiao(5)] },
  ];
  const hand = [tong(1), tong(1), tong(1), tong(2), tong(2), tong(2), tong(3), tong(3), tong(3), tong(4), tong(4)];
  const r1 = MJ.checkWinEx(hand, melds, 8);
  ok(r1.win === true, '（前提）两碰 + 111/222/333筒 + 44筒 → 成牌', r1.win);
  ok(r1.feats.wujinDuizi === true && r1.feats.youjinDuizi === false, '全是碰 + 暗刻 → 无金对对胡', r1.feats);

  const melds2 = [{ type: 'chi', tiles: [tiao(1), tiao(2), tiao(3)] }];
  const hand2 = [tiao(5), tiao(5), tiao(5), tiao(6), tiao(6), tiao(6), tiao(7), tiao(7), tiao(7),
    tiao(9), tiao(9), tong(4), tong(5), tong(6)];
  const r2 = MJ.checkWinEx(hand2, melds2, 8);
  ok(r2.win === true, '（前提）吃 123条 + 555/666/777条 + 99条 + 456筒 → 成牌', r2.win);
  ok(r2.feats.pengpeng === false, '有吃 → 不是对对胡', r2.feats);
}

// ---------- 4.5 无金对对胡的奖励片数 = 12 ----------
{
  const r = mkRoom(8);              // 金 = 九万，这手没有金
  const p = r.getPlayer(0);
  p.flowerCount = 2;                // 2 花 → 基础 1 片，排除 0 花胡叠加
  // 111万 + 222万 + 111条 + 555条 + 444筒 + 66筒将（5 刻 + 将，三花色，不触发清/混）
  p.hand = [0, 0, 0, 1, 1, 1, 9, 9, 9, 13, 13, 13, 21, 21, 21, 23, 23].sort((a, b) => a - b);
  const res = r.checkWinOf(p);
  ok(res.win === true, '（前提）5 刻 + 将 → 成牌', res);
  ok(res.feats.wujinDuizi === true, '（前提）判为无金对对胡', res.feats);
  const s = r.calcDaluan(res, { winner: p, zimo: false, from: 1 });
  const hit = s.detail.find((x) => x.startsWith('无金对对胡'));
  ok(hit === '无金对对胡（12）', '无金对对胡加 12 片', s.detail);
  ok(s.fan === 13, '基础 1 片 + 12 = 13 片', s.fan);
}

// ---------- 5. 金雀：双金作将，副露也算面子 ----------
{
  const melds = [{ type: 'peng', tiles: [tiao(5), tiao(5), tiao(5)] }]; // 碰五条
  const hand = [8, 8,                       // 金金（九万）
    tiao(1), tiao(2), tiao(3),
    tiao(6), tiao(7), tiao(8),
    tong(4), tong(5), tong(6),
    tong(7), tong(8), tong(9)];
  const r = MJ.checkWinEx(hand, melds, 8);
  ok(r.win === true, '双金作将 + 4 个面子（含副露）→ 成牌', r.win);
  ok(r.feats.jinque === true, '标记金雀', r.feats);
}

// ---------- 6. 听牌判定也不能跨副露借牌 ----------
{
  const melds = [{ type: 'peng', tiles: [tiao(9), tiao(9), tiao(9)] }];
  // 13 张：123条 + 456条 + 456筒 + 789条 + 5条单张 → 听 5条
  const good = [tiao(1), tiao(2), tiao(3), tiao(4), tiao(5), tiao(6),
    tong(4), tong(5), tong(6), tiao(7), tiao(8), tiao(9), tiao(5)];
  ok(MJ.isTingEx(good, melds, 8) === true, '合法听牌能听出来（等五条做将）', MJ.isTingEx(good, melds, 8));
  ok(MJ.checkWinEx(good.concat([tiao(5)]), melds, 8).win === true, '摸到五条确实能胡', MJ.checkWinEx(good.concat([tiao(5)]), melds, 8).win);

  const bad = [tiao(1), tiao(3), tiao(4), tiao(7),
    tong(1), tong(2), tong(3), tong(4), tong(5), tong(6), tong(7), tong(8), tong(9)];
  ok(MJ.isTingEx(bad, melds, 8) === false, '凑不出来的暗牌不算听', MJ.isTingEx(bad, melds, 8));
}

// ---------- 7. 机器人不会再把这种牌胡掉 ----------
{
  const r = mkRoom(8);
  const p = r.getPlayer(0);
  p.isBot = true;
  p.melds = [
    { type: 'chi', tiles: [tong(1), tong(2), tong(3)], from: 1 },
    { type: 'peng', tiles: [tiao(9), tiao(9), tiao(9)], from: 2 },
    { type: 'chi', tiles: [tiao(6), tiao(7), tiao(8)], from: 3 },
  ];
  p.hand = [tiao(1), tiao(2), tiao(3), tiao(4), tiao(5), tong(4), tong(5), tong(6)];
  p.lastDrawn = tiao(1);
  const st = r.getState(0);
  ok(!(st.actions || []).includes('hu'), '前端不给"胡"按钮', st.actions);
  BOT.botDecide(r, 0);
  ok(!r.winners, '机器人也不会胡这手牌', r.winners && r.winners.labels);
}

console.log(`\n副露边界：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
