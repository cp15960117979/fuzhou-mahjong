// 「刚摸上来的那张放最右边」测试：drawn 字段的下发与失效时机
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

function setup() {
  const r = new Room('D');
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

// 1) 摸牌后：自己能看到 drawn，别家看不到
{
  const r = setup();
  const p0 = r.getPlayer(0);
  // 16 张散牌（不成胡），确保摸完不会自动结算
  p0.hand = [0, 1, 2, 4, 5, 6, 9, 10, 11, 13, 14, 15, 18, 19, 20, 22];
  r.wall.push(7); // 下一张摸到 8 万
  r.drawCurrent();
  const st = r.getState(0);
  ok(st.players[0].drawn === 7, '自己摸牌后 drawn = 刚摸的牌', st.players[0].drawn);
  ok(st.players[0].hand.includes(7), '摸到的牌已进手牌', st.players[0].hand);
  ok(r.getState(1).players[0].drawn === null, '别家看不到你的 drawn', r.getState(1).players[0].drawn);
  ok(r.getState(0).players[1].drawn === null, '别家自己也没有 drawn', r.getState(0).players[1].drawn);
}

// 2) 打出牌后：drawn 失效（下一张不再高亮，手牌恢复全排序）
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.hand = [0, 1, 2, 4, 5, 6, 9, 10, 11, 13, 14, 15, 18, 19, 20, 22];
  r.wall.push(7);
  r.drawCurrent();
  ok(r.getState(0).players[0].drawn === 7, '摸牌后 drawn 有效');
  r.discard(0, 0);
  ok(r.getState(0).players[0].drawn === null, '打出别的牌后 drawn 清空', r.getState(0).players[0].drawn);
}

// 3) 打出刚摸的那张：drawn 也清空
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.hand = [0, 1, 2, 4, 5, 6, 9, 10, 11, 13, 14, 15, 18, 19, 20, 22];
  r.wall.push(7);
  r.drawCurrent();
  r.discard(0, 7);
  ok(!p0.hand.includes(7) || r.getState(0).players[0].drawn === null, '打掉刚摸的牌后 drawn 清空',
    JSON.stringify(r.getState(0).players[0].drawn));
}

// 4) 碰别人的牌后：不再显示"刚摸的"（碰完手牌 3n+1）
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.hand = [3, 3, 0, 1, 2, 9, 10, 11, 13, 14, 15, 18, 19, 20, 22, 23];
  p0.lastDrawn = 23;
  r.turn = 1;
  r.doPeng(0, 3, 1);
  ok(r.getState(0).players[0].drawn === null, '碰完不显示刚摸的牌', r.getState(0).players[0].drawn);
}

// 5) 暗杠补牌后：drawn = 补摸的那张
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.hand = [0, 0, 0, 0, 1, 2, 4, 5, 6, 9, 10, 11, 13, 14, 15, 18, 19];
  p0.lastDrawn = 19;
  r.wall.push(7);
  const res = r.anGang(0, 0);
  ok(res.ok, '暗杠成立', JSON.stringify(res));
  ok(r.getState(0).players[0].drawn === 7, '杠后补牌成为新的 drawn', r.getState(0).players[0].drawn);
}

// 6) 加杠补牌后：drawn = 补摸的那张
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.melds = [{ type: 'peng', tiles: [3, 3, 3], from: 1 }];
  p0.hand = [3, 0, 1, 2, 4, 5, 6, 9, 10, 11, 13, 14, 15, 18, 19, 22, 23];
  p0.lastDrawn = 22;
  r.wall.push(7);
  const res = r.buGang(0, 3);
  ok(res.ok, '加杠成立', JSON.stringify(res));
  ok(r.getState(0).players[0].drawn === 7, '加杠补牌成为新的 drawn', r.getState(0).players[0].drawn);
}

// 7) 金坎：手牌盖倒，不下发 drawn
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.hand = [3, 4, 5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 19, 20, 22, 23];
  p0.jinKan = true;
  p0.lastDrawn = 23;
  const st = r.getState(0);
  ok(st.players[0].drawn === null, '金坎盖倒时不给 drawn', st.players[0].drawn);
  ok(st.players[0].hand === undefined, '金坎连自己也不下发牌面', st.players[0].hand);
}

// 8) 结算亮牌：不再有"刚摸的"高亮
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.hand = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 5, 6, 7, 7];
  p0.lastDrawn = 7;
  r.doHu(0, true, 0, {});
  const st = r.getState(0);
  ok(st.players.every((p) => p.drawn === null), '结算时四家都没有 drawn', st.players.map((p) => p.drawn));
  ok(Array.isArray(st.players[3].hand), '结算仍然亮出别家手牌');
}

// 9) 花牌补摸：drawn 是最终摸到的数牌，不是花
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.hand = [0, 1, 2, 4, 5, 6, 9, 10, 11, 13, 14, 15, 18, 19, 20, 22];
  r.wall.push(7);   // 先摸到 8 万（后入后出，pop 顺序）
  r.wall.push(30);  // 再摸到花（先弹出）
  r.drawCurrent();
  ok(r.getState(0).players[0].drawn === 7, '摸花补摸后 drawn = 数牌那张', r.getState(0).players[0].drawn);
  ok(p0.flowerCount === 1, '花已计分', p0.flowerCount);
}

console.log(`\n摸牌位置：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
