// 结算亮牌 + 跨局累计输赢测试
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

// 17 张自摸牌型：000 111 222 333 456 + 77（纯清一色 + 0 花）
const WIN17 = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 5, 6, 7, 7];

function setup() {
  const r = new Room('S');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = 26; r.turn = 0; r.selfCanHu = false;
  r.lastDiscard = null;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.jinKan = false; p.declaredTing = false;
    p.lastDrawn = -1; p.flowerCount = 0; p.eatPongCount = 0; p.providers = []; p.score = 0;
  });
  return r;
}

// 1) 自摸结算：记录胡的那张、本局加减、四家亮牌
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.hand = WIN17.slice();
  p0.lastDrawn = 7;
  const res = r.doHu(0, true, 0, {});
  ok(res.ok, '自摸成立', JSON.stringify(res));
  const w = r.winners;
  ok(w.winTile === 7, '记录胡的那张（自摸=刚摸的牌）', w.winTile);
  const total = w.payers.reduce((s, x) => s + x.amount, 0);
  ok(w.deltas[0] === total, '赢家本局 = 三家合计', `${w.deltas[0]} vs ${total}`);
  ok(w.payers.every((x) => w.deltas[x.seat] === -x.amount), '付款人本局 = 负数', JSON.stringify(w.deltas));
  ok(Math.abs(r.players.reduce((s, p) => s + p.score, 0)) < 0.001, '四家分数总和为 0', r.players.map((p) => p.score));
  ok(r.getPlayer(0).score === total, '赢家累计 = 本局', r.getPlayer(0).score);

  // 结算时四家手牌全部下发（含别家）
  const st = r.getState(2);
  ok(st.players.every((p) => Array.isArray(p.hand)), '结算时四家手牌都亮出', st.players.map((p) => !!p.hand));
  ok(st.players[0].hand.length === 17, '赢家亮出 17 张', st.players[0].hand.length);
  ok(st.players[2].score === -w.payers.find((x) => x.seat === 2).amount && st.players[0].score === total,
    '状态里带累计分数（付款人为负）', st.players.map((x) => x.seat + ':' + x.score));
}

// 2) 下一局：分数继续累加，不清零
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.hand = WIN17.slice(); p0.lastDrawn = 7;
  r.doHu(0, true, 0, {});
  const round1 = p0.score;
  // 第二局：换人胡
  r.phase = 'playing'; r.pending = null; r.winners = null;
  const p1 = r.getPlayer(1);
  p1.hand = WIN17.slice(); p1.lastDrawn = 7;
  r.doHu(1, true, 1, {});
  ok(p0.score < round1, '上局赢家这局要扣分（累计变小）', [round1, p0.score]);
  ok(p1.score > 0, '这局赢家累计为正', p1.score);
  ok(Math.abs(r.players.reduce((s, p) => s + p.score, 0)) < 0.001, '两局后四家总和仍为 0', r.players.map((p) => p.score));
  const st = r.getState(0);
  ok(st.players.every((p) => typeof p.score === 'number'), '状态里每个人都有累计分数');
}

// 3) 流局不动分
{
  const r = setup();
  r.players.forEach((p) => { p.score = 5; });
  r.endDraw();
  ok(r.players.every((p) => p.score === 5), '流局不改变累计分数', r.players.map((p) => p.score));
  ok(r.getState(0).players.every((p) => Array.isArray(p.hand)), '流局也亮牌', r.getState(0).players.map((p) => !!p.hand));
}

// 4) 抢杠胡也计分（胡的那张来自杠家，不在赢家手里）
{
  const r = setup();
  r.getPlayer(0).melds = [{ type: 'peng', tiles: [7, 7, 7], from: 1 }];
  r.getPlayer(0).hand = [7, 5, 5, 9, 10, 11, 13, 13, 18, 19, 20, 35, 35, 36];
  const w1 = r.getPlayer(1);
  w1.melds = [
    { type: 'peng', tiles: [0, 0, 0], from: 0 },
    { type: 'peng', tiles: [1, 1, 1], from: 2 },
    { type: 'peng', tiles: [2, 2, 2], from: 3 },
  ];
  w1.hand = [3, 3, 3, 4, 5, 6, 7];
  w1.lastDrawn = 7;
  r.getPlayer(2).hand = [9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22, 23, 35, 36, 37, 38];
  r.getPlayer(3).hand = [9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22, 23, 35, 36, 37, 38];
  r.buGang(0, 7);
  r.claim(1, 'hu');
  const w = r.winners;
  ok(w.winTile === 7, '抢杠胡记录被抢的那张', w.winTile);
  ok(w1.score > 0 && r.getPlayer(0).score < 0, '抢杠胡正常加减分', [w1.score, r.getPlayer(0).score]);
  ok(Math.abs(r.players.reduce((s, p) => s + p.score, 0)) < 0.001, '抢杠胡后总和为 0', r.players.map((p) => p.score));
}

// 5) 新开一桌（roundNo=0）才清零
{
  const r = setup();
  r.players.forEach((p) => { p.score = -3; });
  r.roundNo = 0;
  r.phase = 'ended';
  r.startGame();
  ok(r.players.every((p) => p.score === 0), '重新开桌分数清零', r.players.map((p) => p.score));
}

console.log(`\n结算/累计：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
