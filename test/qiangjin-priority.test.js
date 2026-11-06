// 抢金优先于吃/碰/杠 的专项：
//   抢金窗口（庄家开金后首打这一手）里，只要还有人"能抢金"且没表态，
//   其他家的吃/碰/杠一律挂起；只有能抢金的家全部明确点「过」，吃碰杠才生效。
//   这不是"谁先点谁得"，也不是"碰压吃"，是抢金绝对优先。
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

// joker = 26（九筒）。庄家 0 打 15（七条），opening = true → 打开抢金窗口。
const QJ_HAND = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21]; // + 公示金 = 123/456/789万 + 123/456条 + 将

function table(hands) {
  const r = new Room('QJP');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.jinKanActive = false; r.joker = 26;
  r.dealer = 0; r.turn = 0; r.opening = true; r.pending = null; r.winners = null;
  r.players.forEach((p, i) => {
    p.hand = hands[i].slice(); p.melds = []; p.discards = []; p.flowerCount = 2;
    p.declaredTing = false; p.jinKan = false; p.lastDrawn = -1; p.eatPongCount = 0; p.providers = [];
  });
  const res = r.discard(0, 15);
  if (!res.ok) throw new Error('discard failed: ' + res.msg);
  return r;
}

const DEALER17 = [15, 0, 2, 4, 9, 11, 13, 18, 20, 22, 24, 35, 37, 39, 41, 43, 45]; // 打 15 后 16 张，抢不了
const PENG_15 = [15, 15, 0, 2, 4, 9, 11, 13, 18, 20, 22, 24, 35, 37, 39, 41];    // 能碰 15，抢不了
const CHI_15 = [13, 14, 0, 2, 4, 9, 11, 18, 20, 22, 24, 35, 37, 39, 41, 43];     // 能吃 13+14+15，抢不了
const DEAD = [0, 2, 4, 6, 8, 9, 11, 13, 18, 20, 22, 24, 36, 38, 40, 42];         // 什么都做不了

// 1) 单家能抢金 + 碰家先点 → 碰挂起；抢金家过 → 碰生效
{
  const r = table([DEALER17, QJ_HAND, PENG_15, DEAD]);
  ok(r.pending && r.pending.qiangjin === true, '打开了抢金窗口');
  ok((r.pending.qjSeats || []).length === 1 && r.pending.qjSeats[0] === 1, '识别出只有座位 1 能抢金', JSON.stringify(r.pending.qjSeats));
  r.claim(2, 'peng');
  ok(r.getPlayer(2).melds.length === 0, '碰没有立即生效', r.getPlayer(2).melds.length);
  ok(r.pending.pengIntent && r.pending.pengIntent.seat === 2, '碰已挂起等抢金');
  ok((r.getState(2).pending.qjWait || []).includes(1), '前端能拿到"还在等谁抢金"');
  r.claim(1, 'pass');
  ok(r.getPlayer(2).melds.length === 1, '抢金家点过后，碰才生效', r.getPlayer(2).melds.length);
  ok(r.turn === 2, '轮到碰家出牌', r.turn);
}

// 2) 两家能抢金：只过一家 → 碰仍然挂着；两家都过 → 碰才生效
{
  const r = table([DEALER17, QJ_HAND, PENG_15, QJ_HAND]);
  ok((r.pending.qjSeats || []).length === 2, '两家都能抢金', JSON.stringify(r.pending.qjSeats));
  r.claim(2, 'peng');
  ok(r.getPlayer(2).melds.length === 0, '碰挂起');
  r.claim(1, 'pass');
  ok(r.getPlayer(2).melds.length === 0, '只过了一家，碰还不能生效', r.getPlayer(2).melds.length);
  ok(r.pending && r.pending.pengIntent && r.pending.pengIntent.seat === 2, '碰仍在等另一家');
  r.claim(3, 'pass');
  ok(r.getPlayer(2).melds.length === 1, '两家都过，碰生效', r.getPlayer(2).melds.length);
  ok(r.turn === 2, '轮到碰家', r.turn);
}

// 3) 吃同样让位给抢金
{
  const r = table([DEALER17, CHI_15, QJ_HAND, DEAD]);
  ok(r.getState(1).actions.some((a) => a && a.act === 'chi'), '座位 1 有吃按钮');
  r.claim(1, 'chi', { combo: [13, 14] });
  ok(r.getPlayer(1).melds.length === 0, '吃没有立即生效', r.getPlayer(1).melds.length);
  ok(r.pending.chiIntent && r.pending.chiIntent.seat === 1, '吃已挂起等抢金');
  r.claim(2, 'pass');
  ok(r.getPlayer(1).melds.length === 1 && r.getPlayer(1).melds[0].type === 'chi', '抢金家点过后吃生效');
  ok(r.turn === 1, '轮到吃家', r.turn);
}

// 4) 抢金家直接喊胡 → 已挂起的碰作废
{
  const r = table([DEALER17, QJ_HAND, PENG_15, DEAD]);
  r.claim(2, 'peng');
  r.claim(1, 'hu');
  ok(r.winners && r.winners.winner === 1, '抢金成功', r.winners && r.winners.winner);
  ok(r.winners && r.winners.qiangjin === true, '结算按抢金算', r.winners && r.winners.qiangjin);
  ok(r.getPlayer(2).melds.length === 0, '碰作废', r.getPlayer(2).melds.length);
  ok(r.winners && r.winners.winTile === 26, '胡的是公示金不是弃牌', r.winners && r.winners.winTile);
}

// 5) 窗口里没人能抢金 → 碰照常立即生效（不受影响）
{
  const r = table([DEALER17, DEAD, PENG_15, DEAD]);
  ok((r.pending.qjSeats || []).length === 0, '没人能抢金', JSON.stringify(r.pending.qjSeats));
  r.claim(2, 'peng');
  ok(r.getPlayer(2).melds.length === 1, '没抢金时碰立即生效', r.getPlayer(2).melds.length);
  ok(r.turn === 2, '轮到碰家', r.turn);
}

// 6) 非抢金窗口（opening=false）的普通碰：不受抢金逻辑影响
{
  const r = table([DEALER17, DEAD, PENG_15, DEAD]);
  r.opening = false;
  r.pending = null; r.turn = 0;
  r.getPlayer(0).hand.push(15);
  r.discard(0, 15);
  ok(!r.pending || !r.pending.qiangjin, '这不是抢金窗口');
  r.claim(2, 'peng');
  ok(r.getPlayer(2).melds.length === 1, '普通窗口碰立即生效', r.getPlayer(2).melds.length);
}

console.log(`\n抢金优先：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
