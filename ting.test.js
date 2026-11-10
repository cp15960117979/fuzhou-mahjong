// 报听按钮：清/混一色 + 吃碰 ≥3 手才需要宣告；摸到那张杂色不该把按钮藏掉
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

// 4 副露全筒（4 手），手里 4 张：21 22 金(当23) + 24 单钓
const MELDS = [
  { type: 'peng', tiles: [18, 18, 18], from: 0 },
  { type: 'peng', tiles: [19, 19, 19], from: 1 },
  { type: 'peng', tiles: [25, 25, 25], from: 0 },
  { type: 'peng', tiles: [26, 26, 26], from: 3 },
];

function room(hand, { eatPongCount = 4, declaredTing = false, turn = 0 } = {}) {
  const r = new Room('T');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.pending = null;
  r.joker = 8; // 金 = 九万
  r.turn = turn;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.flowerCount = 5;
    p.jinKan = false; p.declaredTing = false; p.eatPongCount = 0; p.lastDrawn = -1;
  });
  const p = r.getPlayer(turn);
  p.melds = MELDS.map((m) => ({ ...m, tiles: m.tiles.slice() }));
  p.hand = hand.slice();
  p.eatPongCount = eatPongCount;
  p.declaredTing = declaredTing;
  return r;
}

// 1) 摸到同门（筒）：听牌形态 → 有报听按钮
{
  const r = room([21, 22, 8, 24, 25]);
  const acts = r.getState(0).actions;
  ok(acts.includes('ting'), '4 手副露 + 摸到同门 → 有"报听"按钮', JSON.stringify(acts));
}

// 2) 摸到一张杂色（八条）：打掉它还是混一色听牌 → 按钮不能消失
{
  const r = room([21, 22, 8, 24, 16]);
  const acts = r.getState(0).actions;
  ok(acts.includes('ting'), '摸到一张杂色（打掉就纯了）→ 仍然有"报听"按钮', JSON.stringify(acts));
}

// 3) 手里不止一张杂色 → 不是清混，不该给报听
{
  const r = room([21, 22, 8, 24, 16, 17]);
  r.getPlayer(0).hand = [21, 22, 8, 24, 16, 17]; // 6 张：3n+0，也顺手验一下不会误给
  const acts = r.getState(0).actions;
  ok(!acts.includes('ting'), '两张杂色 → 不是清混，不给报听', JSON.stringify(acts));
}

// 4) 吃碰不足 3 手：清混也不需要宣告（包牌门槛）
{
  const r = room([21, 22, 8, 24, 25], { eatPongCount: 2 });
  const acts = r.getState(0).actions;
  ok(!acts.includes('ting'), '吃碰只有 2 手 → 不用宣告', JSON.stringify(acts));
}

// 5) 已经报听过：不再重复给按钮
{
  const r = room([21, 22, 8, 24, 25], { declaredTing: true });
  const acts = r.getState(0).actions;
  ok(!acts.includes('ting'), '已报听 → 不再出按钮', JSON.stringify(acts));
  ok(r.getState(0).players.find((p) => p.seat === 0).declaredTing === true, '状态里仍标着已听（前端显示"已听"）');
}

// 6) 报听真的能点上（declareTing 生效 + 日志）
{
  const r = room([21, 22, 8, 24, 25]);
  const res = r.declareTing(0);
  ok(res.ok, 'declareTing 成功', JSON.stringify(res));
  ok(r.getPlayer(0).declaredTing === true, '标记为已听');
  ok(r.log.some((x) => x.includes('宣告听牌')), '日志有"宣告听牌"');
  ok(!r.getState(0).actions.includes('ting'), '报听后按钮消失');
}

console.log(`\n报听按钮：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
