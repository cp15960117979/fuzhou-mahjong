// 大单调：5 组副露 + 手上只剩 1 张（这张就是要钓的将）
//   剩金 → 摸什么都能胡，记「大单调(有金)」8 片
//   剩数牌 → 只能钓同一张，记「大单调」12 片
//   4 组副露、手上还有 4 张（一搭 + 单张）只是普通"单钓将"，不算大单调。
const { Room } = require('../src/game.js');
const MJ = require('../src/mahjong.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

function room(joker = 26) {
  const r = new Room('DD');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.turn = 0; r.dealer = 0;
  r.joker = joker; r.pending = null; r.winners = null; r.lianZhuang = 0; r.jinKanActive = false;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.flowerCount = 0;
    p.jinKan = false; p.lastDrawn = -1; p.declaredTing = false; p.score = 0;
  });
  return r;
}

// 5 组副露（3 吃 + 2 碰，避开对对胡与清/混一色）
const FIVE = [
  { type: 'chi', tiles: [0, 1, 2], from: 1 },
  { type: 'chi', tiles: [3, 4, 5], from: 2 },
  { type: 'peng', tiles: [18, 18, 18], from: 3 },
  { type: 'chi', tiles: [9, 10, 11], from: 1 },
  { type: 'peng', tiles: [21, 21, 21], from: 2 },
];
// 4 组副露（截图那种：4 副露 + 手上一搭 + 单张）
const FOUR = FIVE.slice(0, 4);

// 1) 5 副露 + 手上一张数牌，自摸同一张 → 大单调（12）
{
  const r = room();
  const p = r.getPlayer(0);
  p.melds = FIVE.map((m) => ({ ...m }));
  p.hand = [12, 12]; // 手上本来只有 4 条，刚摸到的也是 4 条
  p.lastDrawn = 12;
  p.flowerCount = 2;
  const res = r.selfHu(0);
  ok(res && res.ok, '5 副露 + 单钓 4 条能自摸', res);
  const w = r.winners;
  ok(w.danDiao === true, '标记大单调', w.danDiao);
  ok(w.danDiaoHasJin === false, '这手没金 → 不是"大单调(有金)"', w.danDiaoHasJin);
  ok((w.detail || []).some((x) => x === '大单调（12）'), '明细写「大单调（12）」', w.detail);
  // 花 2 → 4 朵 → 1 片；大单调 12 → 13
  ok(w.fan === 13, `2 花大单调 = 13 片，实=${w.fan}（${w.summary}）`, w.summary);
}

// 2) 5 副露 + 手上只剩一张金，摸到任意牌都能胡 → 大单调(有金)（8）
{
  const r = room(26);
  const p = r.getPlayer(0);
  p.melds = FIVE.map((m) => ({ ...m }));
  p.hand = [26, 14]; // 手上剩金，摸到六条，金当六条成将
  p.lastDrawn = 14;
  p.flowerCount = 2;
  const res = r.selfHu(0);
  ok(res && res.ok, '手里剩金，摸到六条也能胡', res);
  const w = r.winners;
  ok(w.danDiao === true && w.danDiaoHasJin === true, '标记「大单调(有金)」', [w.danDiao, w.danDiaoHasJin]);
  ok((w.detail || []).some((x) => x === '大单调(有金)（8）'), '明细写「大单调(有金)（8）」', w.detail);
  // 花 2 + 金 1 = 3 朵 → 6 → 2 片；+8 = 10
  ok(w.fan === 10, `2 花 + 1 金 的大单调(有金) = 10 片，实=${w.fan}（${w.summary}）`, w.summary);
}

// 3) 4 副露 + 手上一搭 + 单张（截图那手）→ 只是普通单钓将，不算大单调
{
  const r = room();
  const p = r.getPlayer(0);
  p.melds = FOUR.map((m) => ({ ...m }));
  p.hand = [12, 13, 14, 15, 15]; // 456 条 + 99 条（刚摸到 9 条成将）
  p.lastDrawn = 15;
  p.flowerCount = 2;
  const res = r.selfHu(0);
  ok(res && res.ok, '4 副露 + 单钓将能自摸', res);
  const w = r.winners;
  ok(w.danDiao === false, '4 副露不是大单调（手牌还剩 4 张）', w.danDiao);
  ok(!(w.detail || []).some((x) => x.includes('大单调')), '结算里没有大单调', w.detail);
  // 花 2 + 自摸 1 = 3 朵 → 6 → 2 片
  ok(w.fan === 2, `这手只是 2 片普通自摸，实=${w.fan}（${w.summary}）`, w.summary);
}

// 4) 4 副露 + 单钓将 + 混一色 → 只有混一色，没有大单调
{
  const r = room(8); // 金 = 九万
  const p = r.getPlayer(0);
  p.melds = [
    { type: 'peng', tiles: [18, 18, 18], from: 1 },
    { type: 'peng', tiles: [19, 19, 19], from: 2 },
    { type: 'peng', tiles: [25, 25, 25], from: 3 },
    { type: 'peng', tiles: [26, 26, 26], from: 1 },
  ];
  p.hand = [21, 22, 8, 24, 24]; // 21 22 + 金(当 23) 成顺子，24 单钓成将
  p.lastDrawn = 24;
  p.flowerCount = 5;
  const res = r.selfHu(0);
  ok(res && res.ok, '混一色单钓才能自摸', res);
  ok(r.winners.danDiao === false, '混一色单钓将不算大单调', r.winners.danDiao);
  ok((r.winners.labels || []).includes('混一色'), '标签只有混一色', r.winners.labels);
  ok(!(r.winners.detail || []).some((x) => x.includes('大单调')), '结算没有大单调', r.winners.detail);
}

// 5) 5 副露 + 单张金，别人打出任意牌 → 不能点炮（大单调有金只能自摸）
{
  const r = room(26);
  const p = r.getPlayer(1);
  p.melds = FIVE.map((m) => ({ ...m }));
  p.hand = [26];
  p.flowerCount = 2;
  ok(r.fullTiles(p).length === 16, '（前提）5 副露 + 1 张 = 16 张听牌', r.fullTiles(p).length);
  ok(r.checkWinOf(p, [14]).win === true, '（前提）别人打六条确实能成牌');
  ok(r.canRon(p, 14, false) === false, '大单调(有金) 只能自摸，不能点炮');
  ok(r.isXiaoHuOnly(p, 14, false) === true, '按钮层面不给"胡"，只提示只能自摸');
}

// 6) 5 副露 + 单张数牌，别人打出同一张 → 大单调是大牌，可以点炮
{
  const r = room();
  const p = r.getPlayer(1);
  p.melds = FIVE.map((m) => ({ ...m }));
  p.hand = [12];
  p.flowerCount = 2;
  ok(r.canRon(p, 12, false) === true, '5 副露单钓数牌可以点炮');
  ok(r.isXiaoHuOnly(p, 12, false) === false, '不再当成"只能自摸"的小胡');

  // 完整流程：玩家 0 打出 4 条，玩家 1 应该看到"胡"按钮并能胡成
  const p0 = r.getPlayer(0);
  p0.hand = [12, 0];
  r.turn = 0;
  r.discard(0, 12);
  ok(!!r.pending, '打出 4 条后开出了抢牌窗口', r.pending && r.pending.seats);
  const acts = r.availableClaims(p, 12, 0, false);
  ok(acts.includes('hu'), '副露满 5 组也照样给"胡"按钮', JSON.stringify(acts));
  const res = r.claim(1, 'hu');
  ok(res && res.ok, '点炮大单调能胡成', res);
  const w = r.winners;
  ok(w && w.danDiao === true, '点炮也标大单调', w && w.danDiao);
  ok((w.detail || []).some((x) => x === '大单调（12）'), '点炮明细写「大单调（12）」', w && w.detail);
  ok(w.fan === 13, `2 花点炮大单调 = 13 片，实=${w.fan}（${w.summary}）`, w && w.summary);
}

console.log(`\n大单调：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
