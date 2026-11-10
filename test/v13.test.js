// v14：昵称、代打、掉线重连（昵称 + 房间码）、房主移交
// v13 的账号体系已删除，这里不再测账号，只测"座位只认昵称"之后的行为。
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; console.log('✗', name, extra == null ? '' : '→ ' + extra); }
}
function eq(a, b, name) { ok(a === b, name, `期望 ${b}，实际 ${a}`); }

function mockWs(tag) {
  return {
    tag, seat: null, pid: null, roomId: null, closed: false, readyState: 1,
    send() {},
    close() { this.closed = true; },
  };
}

/* ---------------- 昵称兜底 ---------------- */
{
  const r = new Room('T1');
  const resA = r.addPlayer(mockWs('A'), '');
  eq(r.players[0].name, '玩家1', '不填昵称 → 玩家1');
  ok(!!resA.rtoken && resA.rtoken.length === 24, '每个座位发一个重连令牌');

  r.addPlayer(mockWs('B'), '自定义名');
  eq(r.players[1].name, '自定义名', '自填昵称原样使用');

  r.addPlayer(mockWs('C'), '');
  eq(r.players[2].name, '玩家2', '第二个没名字的按顺序叫玩家2（不是玩家3）');

  r.addPlayer(mockWs('D'), '');
  eq(r.players[3].name, '玩家3', '第三个没名字的叫玩家3');

  ok(r.addPlayer(mockWs('E'), 'x').ok === false, '第 5 个人进不来');

  const r2 = new Room('T2');
  r2.addPlayer(mockWs('A'), '  名 字  ');
  eq(r2.players[0].name, '名 字', '房间层也清洗昵称');
  const long = r2.addPlayer(mockWs('B'), '一二三四五六七八九十十一');
  eq(r2.players[1].name, '一二三四五六七八九十', '昵称最长 10 字');
  ok(long.ok, '超长昵称被截断而不是拒绝');
}

/* ---------------- 代打 ---------------- */
{
  const rd = new Room('T3');
  const ws0 = mockWs('A');
  rd.addPlayer(ws0, '甲');
  for (let i = 0; i < 3; i++) rd.addPlayer(mockWs('b' + i), '');
  ok(rd.setAuto(0, true).ok === false, '没开局不能代打');
  rd.startGame();
  ok(rd.phase === 'swap' || rd.phase === 'playing', '开局后进入换牌/对局');
  ok(rd.setAuto(0, true).ok, '开局后能开代打');
  ok(rd.isAutoSeat(rd.players[0]), '开了代打的席位算自动席位');
  ok(rd.getState(0).players[0].auto === true, '状态里告诉前端在代打');
  eq(rd.getState(0).players[0].autoReason, 'manual', '手动代打标记为 manual');
  ok(rd.setAuto(0, false).ok, '再按一次能取消');
  ok(!rd.isAutoSeat(rd.players[0]), '取消后不再自动');

  // 掉线 → 自动代打（不需要手动开）
  rd.players[0].connected = false;
  ok(rd.isAutoSeat(rd.players[0]), '掉线的席位自动进入代打');
  eq(rd.getState(2).players[0].autoReason, 'offline', '别人看到的是「离线代打」');
  ok(rd.getState(2).players[0].auto === true, '别人看到 auto=true');
  ok(rd.getState(2).players[0].connected === false, '同时能看到离线');
}

/* ---------------- 掉线重连：令牌 / 昵称 ---------------- */
{
  const rr = new Room('T4');
  const wsA = mockWs('A');
  const ra = rr.addPlayer(wsA, '甲');
  const wsB = mockWs('B');
  rr.addPlayer(wsB, '乙');
  rr.addBot(); rr.addBot();       // 凑满 4 人才能开局
  rr.startGame();
  // 甲掉线
  rr.getPlayer(0).connected = false;
  rr.getPlayer(0).ws = null;

  const wsA2 = mockWs('A2');
  const rj = rr.rejoinByName('甲', wsA2);
  ok(rj.ok && rj.seat === 0, '用同一个昵称回到原来的座位');
  ok(rr.getPlayer(0).connected === true, '重连后恢复在线');
  ok(rr.getPlayer(0).ws === wsA2, '连接重新绑定到座位上');
  ok(!rr.isAutoSeat(rr.getPlayer(0)), '重连后自动交还给人');
  ok(rj.rtoken && rj.rtoken !== ra.rtoken, '重连后换发新令牌，旧令牌作废');

  ok(!rr.rejoinByName('不存在的人', mockWs('X')).ok, '没这个昵称 → 不认');
  ok(!rr.rejoinByName('   ', mockWs('Y')).ok, '空昵称 → 不认');

  // 令牌仍然可用（网络断开时前端自动重连走这条路）
  rr.getPlayer(1).connected = false;
  rr.getPlayer(1).ws = null;
  const wsB2 = mockWs('B2');
  const rt = rr.rejoinByToken(rr.getPlayer(1).rtoken, wsB2);
  ok(rt.ok && rt.seat === 1, '令牌也能回到原座位（自动重连）');
}

/* ---------------- 同名接管：旧连接要被踢掉 ---------------- */
{
  const rk = new Room('T4b');
  const oldWs = mockWs('old');
  rk.addPlayer(oldWs, '小明');
  rk.addPlayer(mockWs('other'), '小红');
  const newWs = mockWs('new');
  const rj = rk.rejoinByName('小明', newWs);
  ok(rj.ok && rj.seat === 0, '同名重进 → 接管原座位');
  ok(oldWs.closed === true, '旧连接被关闭，不会两个标签页抢同一手牌');
  ok(oldWs.seat === null && oldWs.roomId === null, '旧连接解绑房间，避免 close 事件把新连接标记成掉线');
  ok(rk.getPlayer(0).ws === newWs && rk.getPlayer(0).connected, '新连接成为这个座位的唯一连接');
}

/* ---------------- 手动代打不因重连被关掉 ---------------- */
{
  const rr = new Room('T4c');
  rr.addPlayer(mockWs('A'), '甲');
  const rb = rr.addPlayer(mockWs('B'), '乙');
  rr.addBot(); rr.addBot();
  rr.startGame();
  rr.setAuto(1, true);
  rr.getPlayer(1).connected = false;
  rr.rejoinByName('乙', mockWs('B2'));
  ok(rr.getPlayer(1).autoManual && rr.isAutoSeat(rr.getPlayer(1)), '手动代打不会因为重连被悄悄关掉');
}

/* ---------------- 房主移交 ---------------- */
{
  const rh = new Room('T5');
  const ha = rh.addPlayer(mockWs('A'), '房主');
  rh.addPlayer(mockWs('B'), '第二人');
  ok(rh.isHostPid(ha.pid), '第一个人是房主');
  rh.getPlayer(0).connected = false;
  ok(rh.ensureHost(), '房主掉线后触发移交');
  ok(rh.isHostPid(rh.getPlayer(1).pid), '房主落到还在线的人身上');
  ok(rh.getPlayer(0).isHost === false, '原房主不再是房主');
  // 原房主用昵称回来，不会把房主身份抢回去
  rh.rejoinByName('房主', mockWs('A2'));
  ok(rh.isHostPid(rh.getPlayer(1).pid), '原房主重连后房主仍在第二人身上');
}

/* ---------------- 会话串味检查 ---------------- */
{
  const rx = new Room('T6');
  const ry = new Room('T7');
  const xa = rx.addPlayer(mockWs('x'), 'X');
  ry.addPlayer(mockWs('y'), 'Y');
  ok(!ry.rejoinByToken(xa.rtoken, mockWs('z')).ok, '别的房间的令牌进不来这个房间');
}

console.log(`\nv14 昵称/代打/重连：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
