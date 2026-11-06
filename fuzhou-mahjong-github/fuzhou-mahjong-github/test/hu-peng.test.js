// 胡 > 碰/杠 > 吃 的优先级专项：
//   任何吃碰杠都必须等"能胡的家"明确表态。哪怕碰家先点，只要有人随后喊胡，碰就作废；
//   只有胡家点「过」，碰/杠/吃才轮得到。（修的是"快胡了被别人碰走"这个痛点）
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

// 座位 0 打 四万(3)：
//   1 = 清一色万，听 3（可点炮，是大牌）
//   2 = 手里两张 3，只能碰
//   3 = 手里 1、2 万，只能吃
function setup() {
  const r = new Room('HP');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = 26; r.turn = 0; r.selfCanHu = false;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.jinKan = false;
    p.declaredTing = false; p.lastDrawn = -1; p.flowerCount = 2; p.providers = [];
  });
  r.players[0].hand = [3, 9, 10, 12, 14, 18, 19, 20, 21, 22, 23, 24, 25, 35, 36, 37];
  r.players[1].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 3];       // 清一色听 3
  r.players[2].hand = [3, 3, 9, 10, 12, 14, 18, 20, 22, 24, 35, 36, 37, 38, 39, 40]; // 碰 3
  r.players[3].hand = [1, 2, 5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22];    // 吃 1,2
  const res = r.discard(0, 3);
  if (!res.ok) throw new Error('discard failed: ' + res.msg);
  return r;
}


// 吃家专用摆牌：只有下家（座位 1）能吃；座位 2 清一色听 3；座位 3 能碰
function setupChi() {
  const r = new Room('HC');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = 26; r.turn = 0; r.selfCanHu = false;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.jinKan = false;
    p.declaredTing = false; p.lastDrawn = -1; p.flowerCount = 2; p.providers = [];
  });
  r.players[0].hand = [3, 9, 10, 12, 14, 18, 19, 20, 21, 22, 23, 24, 25, 35, 36, 37];
  r.players[1].hand = [1, 2, 5, 6, 7, 9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22]; // 只能吃
  r.players[2].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 3];           // 清一色听 3
  r.players[3].hand = [3, 3, 9, 10, 12, 14, 18, 20, 22, 24, 35, 36, 37, 38, 39, 40]; // 能碰
  const res = r.discard(0, 3);
  if (!res.ok) throw new Error('discard failed: ' + res.msg);
  return r;
}

// 1) 碰家先点：不立即生效，挂起等胡家表态
{
  const r = setup();
  ok(r.pending && r.pending.seats.includes(1) && r.pending.seats.includes(2), '窗口里有胡家和碰家');
  ok(r.getState(1).actions.includes('hu'), '座位 1 有胡按钮');
  const c = r.claim(2, 'peng');
  ok(c.ok, '碰的请求被受理', JSON.stringify(c));
  ok(r.getPlayer(2).melds.length === 0, '碰还没生效（等胡家）', r.getPlayer(2).melds.length);
  ok(r.pending && r.pending.pengIntent && r.pending.pengIntent.seat === 2, '已记录碰牌意向');
  ok(r.getState(2).pending.pengIntent === 2, '碰家能看到"等待胡家"状态');
  ok(r.log.some((x) => x.includes('胡优先')), '日志写明胡优先');

  // 胡家喊胡 → 碰作废，胡家胡
  r.claim(1, 'hu');
  if (r.pending) for (const s of r.pending.seats.slice()) if (!r.pending.responded.has(s)) r.claim(s, 'pass');
  ok(r.winners && r.winners.winner === 1, '胡家抢在碰前面胡成', r.winners && r.winners.winner);
  ok(r.getPlayer(2).melds.length === 0, '碰始终没有生效', r.getPlayer(2).melds.length);
}

// 2) 碰家先点，胡家明确点「过」→ 碰才生效
{
  const r = setup();
  r.claim(2, 'peng');
  ok(r.getPlayer(2).melds.length === 0, '碰先挂起', r.getPlayer(2).melds.length);
  r.claim(1, 'pass'); // 大牌故意不胡
  ok(r.getPlayer(2).melds.length === 1 && r.getPlayer(2).melds[0].type === 'peng', '胡家过后碰生效', r.getPlayer(2).melds.length);
  ok(r.turn === 2 && r.pending === null, '轮到碰家出牌', r.turn);
  ok(r.getPlayer(1).melds.length === 0, '胡家没吃碰', r.getPlayer(1).melds.length);
}

// 3) 吃同样要让位给胡：吃（下家）先点 → 挂起；胡家胡 → 吃作废
{
  const r = setupChi();
  ok(r.pending && r.pending.seats.includes(1), '吃家（下家）进了窗口');
  r.claim(1, 'chi', { combo: [1, 2] });
  ok(r.getPlayer(1).melds.length === 0, '吃先挂起（等胡家）', r.getPlayer(1).melds.length);
  ok(r.pending && r.pending.chiIntent && r.pending.chiIntent.seat === 1, '已记录吃牌意向');
  r.claim(2, 'hu');
  if (r.pending) for (const s of r.pending.seats.slice()) if (!r.pending.responded.has(s)) r.claim(s, 'pass');
  ok(r.winners && r.winners.winner === 2, '胡家胡成', r.winners && r.winners.winner);
  ok(r.getPlayer(1).melds.length === 0, '吃没生效', r.getPlayer(1).melds.length);
}

// 4) 吃先挂起，胡家过、碰家也过 → 吃最后生效
{
  const r = setupChi();
  r.claim(1, 'chi', { combo: [1, 2] });
  r.claim(2, 'pass');
  r.claim(3, 'pass');
  ok(r.getPlayer(1).melds.length === 1 && r.getPlayer(1).melds[0].type === 'chi', '都过后吃生效', r.getPlayer(1).melds.length);
  ok(r.turn === 1, '轮到吃家', r.turn);
}

// 5) 没有胡家时，碰立即生效（不能被新逻辑拖慢）
{
  const r = setup();
  r.getPlayer(1).hand = [9, 10, 12, 14, 18, 19, 20, 21, 22, 23, 24, 25, 35, 36, 37, 38]; // 不能胡
  r.pending = null; r.turn = 0;
  r.getPlayer(0).hand.push(3);
  r.discard(0, 3);
  ok(!r.pending.seats.includes(1), '座位 1 不能胡了');
  r.claim(2, 'peng');
  ok(r.getPlayer(2).melds.length === 1, '无胡家时碰立即生效', r.getPlayer(2).melds.length);
  ok(r.turn === 2, '轮到碰家', r.turn);
}

// 6) 杠也要让位：杠家先点 → 挂起，胡家胡则杠作废
{
  const r = setup();
  r.getPlayer(2).hand = [3, 3, 3, 9, 10, 12, 14, 18, 20, 22, 24, 35, 36, 37, 38, 39];
  r.pending = null; r.turn = 0; r.wall = [1, 2, 4, 5];
  r.getPlayer(0).hand = [3, 9, 10, 12, 14, 18, 19, 20, 21, 22, 23, 24, 25, 35, 36, 37];
  r.discard(0, 3);
  ok(r.pending && r.pending.seats.includes(2), '杠家进了窗口');
  r.claim(2, 'gang');
  ok(r.getPlayer(2).melds.length === 0, '杠先挂起', r.getPlayer(2).melds.length);
  r.claim(1, 'hu');
  if (r.pending) for (const s of r.pending.seats.slice()) if (!r.pending.responded.has(s)) r.claim(s, 'pass');
  ok(r.winners && r.winners.winner === 1, '胡家胡成，杠作废', r.winners && r.winners.winner);
  ok(r.getPlayer(2).melds.length === 0, '杠没有生效', r.getPlayer(2).melds.length);
}

console.log(`\n胡>碰杠>吃：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
