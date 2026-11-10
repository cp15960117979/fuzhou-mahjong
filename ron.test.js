// 点炮规则：小胡只能自摸，大牌才能点炮
const { Room } = require('../src/game.js');
const MJ = require('../src/mahjong.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

function room(joker) {
  const r = new Room('R');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.turn = 0; r.joker = joker;
  r.players.forEach((p) => { p.hand = []; p.melds = []; p.discards = []; p.flowerCount = 0; p.jinKan = false; });
  return r;
}

// A. 普通小胡（混花色、有花）：不能点炮
{
  const r = room(26);
  const p = r.getPlayer(2);
  // 17 张：012万 91011条 121314条 181920筒 212223筒 24,24 将
  p.hand = [0, 1, 2, 9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 24, 24].sort((a, b) => a - b);
  p.flowerCount = 3;
  const full = p.hand.concat([23]);
  ok(full.length === 17, '测试牌型为 17 张');
  ok(r.canRon(p, 23) === false, '普通小胡不能点炮');
  ok(r.isXiaoHuOnly(p, 23) === true, '前端能识别"小胡只能自摸"');
}

// B. 清一色：可以点炮
{
  const r = room(26);
  const p = r.getPlayer(1);
  // 17 张：012 345 678 012 345 万 + 66 将
  p.hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 6, 6].sort((a, b) => a - b);
  p.flowerCount = 2;
  ok(r.canRon(p, 5) === true, '清一色可以点炮');
}

// C. 无花胡（大牌）：可以点炮
{
  const r = room(26);
  const p = r.getPlayer(2);
  p.hand = [0, 1, 2, 9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 24, 24].sort((a, b) => a - b);
  p.flowerCount = 0;
  ok(r.canRon(p, 23) === true, '无花胡可以点炮');
}

// D. 金雀（2 金作将）：必须自摸
{
  const r = room(26); // 金 = 九筒
  const p = r.getPlayer(2);
  p.hand = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 26, 26, 18, 19].sort((a, b) => a - b);
  p.flowerCount = 4;
  // 加 20(三筒) 成 17：012 345 91011 121314 181920 + JJ
  ok(r.canRon(p, 20) === false, '金雀必须自摸，不能点炮');
}

// E. 张数不对：一律不判胡
{
  const r = room(26);
  const p = r.getPlayer(2);
  p.hand = [0, 1, 2, 9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 24]; // 15 张（少一张）
  p.flowerCount = 0;
  ok(r.canRon(p, 24) === false, '手牌少一张不能点炮胡');
  ok(r.isXiaoHuOnly(p, 24) === false, '少牌也不会提示小胡');
  const hr = r.doHu(2, true, 2, {});
  ok(hr.ok === false, '自摸时张数不对也判不了胡', JSON.stringify(hr));
}

// F. 别人打牌时，小胡家不给"胡"按钮；大牌家给
{
  const r = room(26);
  const small = r.getPlayer(1), big = r.getPlayer(2);
  small.hand = [0, 1, 2, 9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 24, 24].sort((a, b) => a - b);
  small.flowerCount = 3;
  big.hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 6, 6].sort((a, b) => a - b);
  big.flowerCount = 2; // 清一色
  r.players[0].hand = [23, 5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22, 25];
  r.turn = 0;
  r.discard(0, 23); // 打七筒：P1 小胡听 23，P2 清一色听 5(五万) 不相关
  const acts1 = (r.getState(1).actions || []);
  ok(!acts1.includes('hu'), '小胡家没有"胡"按钮', JSON.stringify(acts1));
  ok((r.getState(1).pending.xiaoHu || []).includes(1), '小胡家收到"只能自摸"提示');
}

// G. 4 副露 + 手里含金（单钓将）+ 混一色：照样可以点炮
//    （以前"4 副露含金 = 大单调"一刀切，把混一色这类大牌也掐掉了 → 没有"胡"按钮）
{
  const r = room(8); // 金 = 九万
  const p = r.getPlayer(2);
  p.melds = [
    { type: 'peng', tiles: [18, 18, 18], from: 0 },
    { type: 'peng', tiles: [19, 19, 19], from: 1 },
    { type: 'peng', tiles: [25, 25, 25], from: 0 },
    { type: 'peng', tiles: [26, 26, 26], from: 3 },
  ];
  p.hand = [21, 22, 8, 24]; // 21 22 + 金(当 23) 成顺子，24 单钓将
  p.flowerCount = 5;
  p.eatPongCount = 4;
  p.declaredTing = true;   // 清/混一色吃碰满 3 手，要先报听才能胡（v14）
  ok(r.fullTiles(p).length === 16, '（前提）4 副露 + 4 张手牌 = 16 张听牌', r.fullTiles(p).length);
  ok(r.canRon(p, 24) === true, '4 副露 + 金 + 混一色（已报听）→ 可以点炮', JSON.stringify(MJ.winLabels(r.fullTiles(p).concat([24]), 8)));
  ok(MJ.winLabels(r.fullTiles(p).concat([24]), 8).includes('混一色'), '这手确实是混一色');
}

// H. 4 副露 + 单钓将（含金）不是大牌：本来就不能点炮（以前误当"大单调(有金)"）
{
  const r = room(8);
  const p = r.getPlayer(2);
  p.melds = [
    { type: 'peng', tiles: [0, 0, 0], from: 0 },
    { type: 'peng', tiles: [9, 9, 9], from: 1 },
    { type: 'peng', tiles: [18, 18, 18], from: 0 },
    { type: 'peng', tiles: [24, 24, 24], from: 3 },
  ];
  p.hand = [1, 2, 8, 4]; // 1 2 + 金(当 3) 成顺子，4 单钓将
  p.flowerCount = 5;
  p.eatPongCount = 4;
  const labels = MJ.winLabels(r.fullTiles(p).concat([4]), 8);
  ok(labels.length === 0, '（前提）这手只是普通牌型（没有大牌奖励）', JSON.stringify(labels));
  ok(r.canRon(p, 4) === false, '4 副露单钓将只是小胡 → 不能点炮');
}

// I. 三金倒只能自己回合倒：别人打出的牌不能胡三金倒
{
  const r = room(26);
  const p = r.getPlayer(1);
  // 16 张：3 金 + 13 张散牌（凑不出牌型，只能靠三金倒）
  p.hand = [26, 26, 26, 0, 2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22];
  p.flowerCount = 3;
  ok(r.checkWinOf(p).type === 'sanjindao', '（前提）3 金散牌 = 三金倒');
  ok(r.canRon(p, 24) === false, '三金倒不能点炮（别人打出的牌不算胡）');
  ok(r.isXiaoHuOnly(p, 24) === false, '也不会误报成"小胡只能自摸"的提示');

  // 同一个牌型，自己回合摸到第 3 张金 → 能倒
  const r2 = room(26);
  const p2 = r2.getPlayer(1);
  p2.hand = [26, 26, 26, 0, 2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22, 24];
  p2.flowerCount = 3;
  p2.lastDrawn = 26;
  r2.turn = 1;
  const res = r2.selfHu(1);
  ok(res && res.ok, '自己回合摸到第 3 张金 → 三金倒能胡', res);
  ok(r2.winners && r2.winners.type === 'sanjindao', '结算按三金倒', r2.winners && r2.winners.type);
  ok((r2.winners.detail || []).some((d) => d.startsWith('三金倒')), '自摸三金倒有 +10 奖励', r2.winners && r2.winners.detail);
}

console.log(`\n点炮规则：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
