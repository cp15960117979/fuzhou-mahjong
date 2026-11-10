// 加杠（补杠）测试：碰过之后手里留着第 4 张，每轮摸牌都可以补杠，直到这张牌被用掉
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

// 构造：座位 1 打出四万(3)，座位 0 手里三张四万 → 碰，手里还留一张四万
function setup(peng = true) {
  const r = new Room('B');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = 26; r.turn = 1; r.selfCanHu = false;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.jinKan = false;
    p.declaredTing = false; p.lastDrawn = -1; p.flowerCount = 0; p.eatPongCount = 0;
  });
  r.players[1].hand = [3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22, 23];
  r.players[0].hand = [3, 3, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 19, 20, 21];
  r.players[2].hand = [5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22, 23, 24];
  r.players[3].hand = [5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22, 23, 24];
  const d = r.discard(1, 3);
  if (!d.ok) throw new Error('discard failed: ' + d.msg);
  if (peng) {
    const c = r.claim(0, 'peng');
    if (c && c.ok === false) throw new Error('peng failed: ' + c.msg);
  }
  return r;
}

// 1) 碰完：手里还剩一张四万，自己回合就能看到"加杠"按钮
{
  const r = setup();
  const p = r.getPlayer(0);
  ok(r.turn === 0, '碰完轮到自己', r.turn);
  ok(p.melds.length === 1 && p.melds[0].type === 'peng' && p.melds[0].tiles.length === 3, '场上是一组碰', JSON.stringify(p.melds));
  ok(p.hand.filter((t) => t === 3).length === 1, '手里还留着第 4 张四万', p.hand);
  const acts = r.getState(0).actions;
  ok(acts.includes('bugang:3'), '出现加杠按钮', JSON.stringify(acts));
  ok(acts.includes('discard'), '同时可以正常出牌', JSON.stringify(acts));
}

// 2) 加杠成功：碰升级成 4 张明杠 + 补摸一张
{
  const r = setup();
  const p = r.getPlayer(0);
  r.wall.push(11); // 固定补摸到 三条，避免随机摸到花/四万影响断言
  const before = r.wall.length;
  const res = r.buGang(0, 3);
  ok(res && res.ok, '加杠成功', JSON.stringify(res));
  ok(p.melds[0].type === 'gang' && p.melds[0].tiles.length === 4, '副露变成 4 张杠', JSON.stringify(p.melds[0]));
  ok(p.melds[0].bugang === true, '标记为加杠（便于区分）');
  ok(!p.hand.includes(3), '手里的第 4 张被用掉', p.hand);
  ok(r.wall.length === before - 1, '补摸了一张', r.wall.length);
  ok(p.hand.length === 14, '补摸后 14 张，等出牌', p.hand.length);
  ok(r.log.some((x) => x.includes('加杠')), '日志写了加杠');
  ok(!r.getState(0).actions.includes('bugang:3'), '杠完不再有这张的加杠按钮');
  // 出掉一张，回到 13 张
  const t = p.hand[0];
  const d = r.discard(0, t);
  ok(d.ok && p.hand.length === 13, '杠后正常出牌', d);
}

// 3) 碰了但把第 4 张打掉 → 以后不再有加杠按钮
{
  const r = setup();
  const p = r.getPlayer(0);
  const d = r.discard(0, 3);
  ok(d.ok, '把多余的四万打掉', d);
  ok(!p.hand.includes(3), '手里不再有四万', p.hand);
  ok(!r.getState(0).actions.includes('bugang:3'), '这张打掉后没有加杠按钮了', JSON.stringify(r.getState(0).actions));
  // 下一轮摸到别的牌也不能补杠
  r.pending = null; r.turn = 0;
  p.hand.push(5);
  ok(!r.getState(0).actions.includes('bugang:3'), '再摸别的牌也杠不了', JSON.stringify(r.getState(0).actions));
}

// 4) 没有碰过 → 不能加杠
{
  const r = setup(false);
  const p = r.getPlayer(0);
  r.pending = null; r.turn = 0;
  p.hand.push(3);
  const res = r.buGang(0, 3);
  ok(res.ok === false && res.msg.includes('没有碰过'), '没碰过不能加杠', JSON.stringify(res));
}

// 5) 不是自己回合 → 不能加杠
{
  const r = setup();
  r.turn = 2;
  const res = r.buGang(0, 3);
  ok(res.ok === false, '不是自己回合不能加杠', JSON.stringify(res));
}

// 6) 手里没第 4 张（已经杠过）→ 不能重复加杠
{
  const r = setup();
  r.buGang(0, 3);
  const res = r.buGang(0, 3);
  ok(res.ok === false, '不能重复加杠', JSON.stringify(res));
}

// 7) 金不能加杠
{
  const r = setup(false);
  const p = r.getPlayer(0);
  r.pending = null; r.turn = 0;
  p.melds.push({ type: 'peng', tiles: [26, 26, 26], from: 1 });
  p.hand.push(26);
  const res = r.buGang(0, 26);
  ok(res.ok === false && res.msg.includes('金'), '金不能加杠', JSON.stringify(res));
}

// 8) 金坎生效期间全场不能加杠
{
  const r = setup();
  r.jinKanActive = true;
  const res = r.buGang(0, 3);
  ok(res.ok === false && res.msg.includes('金坎'), '金坎生效时不能加杠', JSON.stringify(res));
  ok(!r.getState(0).actions.some((a) => typeof a === 'string' && a.startsWith('bugang:')), '金坎时不显示加杠按钮');
}

// 9) 碰完先过一轮（正常打一张再摸一张），只要那张还在手里，仍然可以加杠
{
  const r = setup();
  const p = r.getPlayer(0);
  const other = p.hand.find((t) => t !== 3);
  r.discard(0, other);
  // 模拟轮转一圈回到自己
  r.pending = null;
  r.turn = 0;
  r.drawCurrent();
  const acts = r.getState(0).actions;
  ok(acts.includes('bugang:3'), '下一轮摸牌后仍能加杠', JSON.stringify(acts));
  const res = r.buGang(0, 3);
  ok(res && res.ok, '下一轮加杠成功', JSON.stringify(res));
}

// 10) 牌墙空了不能杠：杠要补一张，补不出就会手牌少一张（流局时曾经出现过 15 张）
{
  const r = setup();
  const p = r.getPlayer(0);
  r.pending = null; r.turn = 0;
  const before = p.hand.length + p.melds.reduce((a, m) => a + m.tiles.length, 0);
  r.wall = [];
  const res = r.buGang(0, 3);
  ok(res.ok === false && res.msg.includes('牌墙'), '墙空不能加杠', JSON.stringify(res));
  const after = p.hand.length + p.melds.reduce((a, m) => a + m.tiles.length, 0);
  ok(after === before && p.melds[0].type === 'peng', '拒绝后手牌与副露不动', `${before}->${after}`);
  ok(!r.getState(0).actions.some((a) => typeof a === 'string' && a.startsWith('bugang:')), '墙空不显示加杠按钮');
}
{
  const r = setup(false);
  const p = r.getPlayer(0);
  r.pending = null; r.turn = 0;
  r.wall = [];
  p.hand.push(3); // 凑满 4 张
  const before = p.hand.slice();
  const res = r.anGang(0, 3);
  ok(res.ok === false && res.msg.includes('牌墙'), '墙空不能暗杠', JSON.stringify(res));
  ok(JSON.stringify(p.hand) === JSON.stringify(before), '暗杠被拒后手牌不变');
  ok(!r.getState(0).actions.some((a) => typeof a === 'string' && a.startsWith('angang:')), '墙空不显示暗杠按钮');
}
{
  const r = setup(false);
  r.turn = 1; r.pending = null;
  const before = r.getPlayer(0).hand.length;
  r.wall = [];
  r.getPlayer(1).hand.push(3); // 座位 1 手里补一张四万再打出来
  r.discard(1, 3);
  const acts = (r.pending && r.pending.acts.find((a) => a.seat === 0) || { acts: [] }).acts;
  ok(!acts.includes('gang') && acts.includes('peng'), '墙空时只给碰不给杠', JSON.stringify(acts));
  const res = r.claim(0, 'gang');
  ok(res && res.ok === false || r.getPlayer(0).hand.length === before, '墙空杠不成立', JSON.stringify(res));
}

// ---------- 杠后能胡：杠在"牌型"里只算 3 张 ----------
// （4 张全算会让整手变 18 张 → need=(18-2)/3 不是整数 → 杠完永远胡不了）
{
  const r = new Room('BW');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = 26; r.turn = 0; r.selfCanHu = true;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.jinKan = false;
    p.declaredTing = false; p.lastDrawn = -1; p.flowerCount = 2; p.eatPongCount = 0; p.providers = [];
  });
  const p0 = r.getPlayer(0);
  p0.melds = [{ type: 'gang', tiles: [9, 9, 9, 9], from: 1 }]; // 明杠一条
  p0.hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 21, 21]; // 4 面子 + 将
  ok(r.fullTiles(p0).length === 17, '杠按 3 张算 → 整手 17 张', r.fullTiles(p0).length);
  const res = r.selfHu(0);
  ok(res && res.ok, '明杠之后能自摸胡（以前杠完永远胡不了）', JSON.stringify(res));
  ok(r.winners && r.winners.winner === 0 && !r.winners.draw, '杠家正常结算');
}
{
  // 暗杠同样
  const r = new Room('BW2');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = 26; r.turn = 0; r.selfCanHu = true;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.jinKan = false;
    p.declaredTing = false; p.lastDrawn = -1; p.flowerCount = 2; p.eatPongCount = 0; p.providers = [];
  });
  const p0 = r.getPlayer(0);
  p0.melds = [{ type: 'angang', tiles: [9, 9, 9, 9], from: -1 }];
  p0.hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 21, 21];
  const res = r.selfHu(0);
  ok(res && res.ok, '暗杠之后也能自摸胡', JSON.stringify(res));
}
{
  // 杠 + 点炮（清一色，仍然按 17 张判）
  const r = new Room('BW3');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = 26; r.turn = 1; r.selfCanHu = false;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.jinKan = false;
    p.declaredTing = false; p.lastDrawn = -1; p.flowerCount = 2; p.eatPongCount = 0; p.providers = [];
  });
  const p0 = r.getPlayer(0);
  p0.melds = [{ type: 'gang', tiles: [0, 0, 0, 0], from: 1 }];
  p0.hand = [1, 1, 1, 2, 2, 2, 3, 4, 5, 6, 7, 8, 8]; // 听 8 万（清一色）
  r.getPlayer(1).hand = [9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 23, 24, 25, 15, 16, 8];
  r.getPlayer(2).hand = [9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 23, 24, 25, 15, 16];
  r.getPlayer(3).hand = [9, 10, 11, 12, 13, 14, 18, 19, 20, 21, 22, 23, 24, 25, 15, 16];
  r.discard(1, 8);
  ok(!!r.pending && r.getState(0).actions.includes('hu'), '杠过之后也能点炮胡（清一色）', JSON.stringify(r.getState(0).actions));
  const res = r.claim(0, 'hu');
  ok(res && res.ok !== false && r.winners && r.winners.winner === 0, '杠 + 点炮正常结算', JSON.stringify(res));
}

// ---------- 报听 / 加杠 是两条并列的路 ----------
// 截图那手：4 副露（234万吃 + 333万碰 + 111万碰 + 777万碰）+ 手里 1万 4万 666万
//   1万 是碰过的第 4 张 → 可以加杠；同一手也满足清一色的报听条件
function tingKongRoom({ wall = 30 } = {}) {
  const r = new Room('BTK');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = 26; r.turn = 0; r.selfCanHu = false;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.jinKan = false;
    p.declaredTing = false; p.lastDrawn = -1; p.flowerCount = 2; p.eatPongCount = 0; p.providers = [];
  });
  // 墙里留几张万子，加杠补到的是万子 → 补完还是清一色
  r.wall = [8, 7, 4, 4, 7];
  if (wall === 0) r.wall = [];
  const p0 = r.getPlayer(0);
  p0.melds = [
    { type: 'chi', tiles: [1, 2, 3], from: 3 },
    { type: 'peng', tiles: [2, 2, 2], from: 1 },
    { type: 'peng', tiles: [0, 0, 0], from: 2 },
    { type: 'peng', tiles: [6, 6, 6], from: 3 },
  ];
  p0.hand = [0, 3, 5, 5, 5];
  p0.lastDrawn = 5;
  p0.eatPongCount = 4;
  return r;
}
{
  const r = tingKongRoom();
  const acts = r.getState(0).actions;
  ok(acts.includes('ting'), '这手可以做清一色：有"宣告听牌"按钮', JSON.stringify(acts));
  ok(acts.includes('bugang:0'), '同一手也能加杠 1 万：按钮要一起给', JSON.stringify(acts));
}
{
  // 先加杠补一张 → 补完仍然可以宣告听牌
  const r = tingKongRoom();
  const res = r.buGang(0, 0);
  ok(res && res.ok !== false, '加杠 1 万能成立', JSON.stringify(res));
  const p0 = r.getPlayer(0);
  ok(p0.melds.some((m) => m.type === 'gang' && m.tiles[0] === 0), '1 万升成明杠（4 张）');
  ok(p0.hand.length === 5, `加杠后补摸一张，手牌应是 5 张，实=${p0.hand.length}`, p0.hand);
  const acts = r.getState(0).actions;
  ok(acts.includes('ting'), '加杠补牌之后，报听按钮还在（可以再听）', JSON.stringify(acts));
}
{
  // 先报听 → 加杠按钮不该被"报听"吃掉
  const r = tingKongRoom();
  r.declareTing(0);
  const acts = r.getState(0).actions;
  ok(!acts.includes('ting'), '报听后不再重复给报听按钮');
  ok(acts.includes('bugang:0'), '报听后加杠 1 万仍然可选（多补一张再听）', JSON.stringify(acts));
}
{
  // 牌墙空了：杠要补牌，补不出来 → 不给加杠按钮，直接调用也会被拒
  const r = tingKongRoom({ wall: 0 });
  const acts = r.getState(0).actions;
  ok(!acts.includes('bugang:0'), '牌墙 0 张 → 不出现"加杠"按钮', JSON.stringify(acts));
  ok(acts.includes('ting'), '但报听仍然可以点（清一色）', JSON.stringify(acts));
  const res = r.buGang(0, 0);
  ok(res && res.ok === false, '牌墙空了加杠要被拒绝', JSON.stringify(res));
}

console.log(`\n加杠：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
