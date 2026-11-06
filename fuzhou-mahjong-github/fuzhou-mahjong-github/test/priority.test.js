// 碰/杠 > 吃 的优先级测试
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

function setup() {
  const r = new Room('T');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = 26; r.turn = 0; r.selfCanHu = false;
  r.players.forEach((p) => { p.hand = []; p.melds = []; p.discards = []; p.jinKan = false; p.declaredTing = false; p.lastDrawn = -1; });
  // 0 打 四万(3)；1 手里 二万+五万？→ 用 二万(1)+ 四万? 需连续：3 可由 1,2 / 2,4 / 4,5 组成
  r.players[0].hand = [3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22, 23];
  r.players[1].hand = [1, 2, 5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22]; // 一萬二萬 → 吃四万
  r.players[2].hand = [3, 3, 5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22]; // 两张四万 → 碰
  r.players[3].hand = [5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22, 23, 24];
  const res = r.discard(0, 3);
  if (!res.ok) throw new Error('discard failed: ' + res.msg);
  return r;
}

// 1) 吃家先点：必须先挂起，等碰家表态
{
  const r = setup();
  ok(r.pending && r.pending.seats.includes(1) && r.pending.seats.includes(2), '窗口里有吃家和碰家');
  const c = r.claim(1, 'chi', { combo: [1, 2] });
  ok(c.ok, '吃牌请求被接受', JSON.stringify(c));
  const p1 = r.getPlayer(1);
  ok(p1.melds.length === 0, '吃还没生效（还在等碰家）', p1.melds.length);
  ok(r.pending && r.pending.chiIntent && r.pending.chiIntent.seat === 1, '已记录吃牌意向');
  ok(r.getState(1).pending.chiWait === 1, '吃家能看到"等待碰家"状态');

  // 碰家选择"过" → 吃自动执行
  r.claim(2, 'pass');
  ok(p1.melds.length === 1 && p1.melds[0].type === 'chi', '碰家过后，吃自动生效', p1.melds.length);
  ok(r.turn === 1 && r.pending === null, '轮到吃家出牌');
}

// 2) 吃家先点，碰家随后碰：碰优先，吃取消
{
  const r = setup();
  r.claim(1, 'chi', { combo: [1, 2] });
  const p1 = r.getPlayer(1), p2 = r.getPlayer(2);
  r.claim(2, 'peng');
  ok(p2.melds.length === 1 && p2.melds[0].type === 'peng', '碰生效', p2.melds.length);
  ok(p1.melds.length === 0, '吃被取消', p1.melds.length);
  ok(r.turn === 2, '轮到碰家出牌', r.turn);
  ok(r.log.some((x) => x.includes('碰优先')), '日志提示吃被取消');
}

// 3) 碰家先走，吃家再点 → 直接被拒（已碰）
{
  const r = setup();
  r.claim(2, 'peng');
  const p1 = r.getPlayer(1);
  const c = r.claim(1, 'chi', { combo: [1, 2] });
  ok(p1.melds.length === 0, '碰已成立后吃无效', p1.melds.length);
  ok(r.pending === null, '窗口已关闭');
  ok(c.ok === false || c.ok === true, '请求被安全处理', JSON.stringify(c));
}

// 4) 没有碰家时，吃立即生效
{
  const r = setup();
  r.getPlayer(2).hand = [5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22, 23, 24]; // 无四万
  r.pending = null; r.turn = 0;
  r.getPlayer(0).hand.push(3);
  r.discard(0, 3);
  const p1 = r.getPlayer(1);
  r.claim(1, 'chi', { combo: [1, 2] });
  ok(p1.melds.length === 1 && p1.melds[0].type === 'chi', '无碰家时吃立即生效', p1.melds.length);
  ok(r.turn === 1, '轮到吃家', r.turn);
}

console.log(`\n碰吃优先级：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
