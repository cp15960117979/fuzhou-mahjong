// 等待阶段「返回首页」的座位重排测试
// 关键点：重排后 server 端每个连接的 ws.seat 必须跟着变，否则玩家操作会打到别人身上
const assert = require('assert');
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('✗', name, extra == null ? '' : '→ ' + extra); }
}
function eq(a, b, name) { ok(a === b, name, `期望 ${b}，实际 ${a}`); }

function mockWs(tag) {
  return {
    tag, seat: null, pid: null, roomId: null,
    send() {}, readyState: 1,
  };
}

function makeRoom(n) {
  const r = new Room('T1');
  const socks = [];
  for (let i = 0; i < n; i++) {
    const ws = mockWs('ws' + i);
    const res = r.addPlayer(ws, 'P' + i);
    ws.pid = res.pid; ws.seat = res.seat; ws.roomId = 'T1';
    socks.push(ws);
  }
  return { r, socks };
}

// ---------- 1. 中间座位退出 ----------
{
  const { r, socks } = makeRoom(4);
  const pid1 = r.players[1].pid;
  const res = r.leaveWaiting(pid1);
  eq(res.ok, true, '中间座位可以退出');
  eq(r.players.length, 3, '退出后剩 3 人');
  eq(r.players.map((p) => p.seat).join(','), '0,1,2', '座位重新连号');
  eq(r.players[0].isHost, true, '原房主仍是房主');
  ok(!r.players.some((p) => p.pid === pid1), '退出的人不在名单里');
  // 后面的连接座位要跟着前移
  eq(socks[2].seat, 1, '原 seat2 的连接同步为 seat1');
  eq(socks[3].seat, 2, '原 seat3 的连接同步为 seat2');
  eq(socks[1].seat, null, '退出者的连接已解绑座位');
  eq(socks[1].pid, null, '退出者的连接已解绑 pid');
  eq(r.getPlayer(1).pid, socks[2].pid, 'getPlayer(1) 指向原来 seat2 的人');
}

// ---------- 2. 房主退出，房主移交 ----------
{
  const { r, socks } = makeRoom(3);
  const hostPid = r.players[0].pid;
  const res = r.leaveWaiting(hostPid);
  eq(res.ok, true, '房主可以退出');
  eq(r.players.length, 2, '剩 2 人');
  eq(r.players[0].isHost, true, '有人接任房主');
  eq(r.players[0].pid, socks[1].pid, '接任的是原第二位玩家');
  eq(r.players[0].seat, 0, '新房主坐 seat 0');
  eq(socks[1].seat, 0, '新房主的连接座位同步为 0');
}

// ---------- 3. 真人必须排在机器人前面（否则 seat0 是机器人，没人能开始） ----------
{
  const r = new Room('T2');
  const ws0 = mockWs('w0'), ws1 = mockWs('w1');
  const a = r.addPlayer(ws0, '真人A'); ws0.pid = a.pid; ws0.seat = a.seat;
  r.addBot();                                  // 机器人坐 seat1
  const c = r.addPlayer(ws1, '真人C'); ws1.pid = c.pid; ws1.seat = c.seat;
  eq(r.players.map((p) => (p.isBot ? 'B' : 'H')).join(''), 'HBH', '初始：真人 / 机器人 / 真人');
  r.leaveWaiting(a.pid);
  eq(r.players.map((p) => (p.isBot ? 'B' : 'H')).join(''), 'HB', '真人离开后：真人排在前、机器人垫后');
  eq(r.getPlayer(0).isHost, true, 'seat0 是真人房主');
  eq(r.getPlayer(0).pid, c.pid, '真人 C 顶到 seat0');
  eq(ws1.seat, 0, '真人 C 的连接座位同步为 0');
  eq(r.getPlayer(1).isBot, true, '机器人留在 seat1');
}

// ---------- 4. 对局中不允许退出 ----------
{
  const { r } = makeRoom(4);
  r.phase = 'playing';
  const res = r.leaveWaiting(r.players[1].pid);
  eq(res.ok, false, '对局中拒绝退出');
  eq(r.players.length, 4, '对局中人数不变');
}

// ---------- 5. 不存在的 pid ----------
{
  const { r } = makeRoom(2);
  const res = r.leaveWaiting('no-such-pid');
  eq(res.ok, false, '陌生 pid 拒绝');
  eq(r.players.length, 2, '人数不变');
}

// ---------- 6. 连续退出到只剩一个人 ----------
{
  const { r, socks } = makeRoom(4);
  eq(r.leaveWaiting(socks[3].pid).ok, true, '退出第 4 人');
  eq(r.leaveWaiting(socks[1].pid).ok, true, '退出第 2 人');
  eq(r.leaveWaiting(socks[2].pid).ok, true, '退出第 3 人');
  eq(r.players.length, 1, '只剩房主');
  eq(r.players[0].pid, socks[0].pid, '剩下的是房主');
  eq(r.players[0].isHost, true, '仍是房主');
  const last = r.leaveWaiting(socks[0].pid);
  eq(last.ok, true, '最后一个人也能退');
  eq(last.humans, 0, 'humans=0 → 服务端据此回收房间');
  eq(r.players.length, 0, '房间清空');
}

// ---------- 7. 退出后新玩家能正常补位 ----------
{
  const { r, socks } = makeRoom(3);
  r.leaveWaiting(socks[1].pid);
  const wsNew = mockWs('new');
  const res = r.addPlayer(wsNew, '新人');
  eq(res.ok, true, '空出的座位可加入');
  eq(res.seat, 2, '新人在末尾入座');
  eq(r.getPlayer(res.seat).name, '新人', '座位指向正确');
}

console.log(`\n返回首页：通过 ${pass} / ${pass + fail}${fail ? '，失败 ' + fail : ''}`);
if (fail) process.exit(1);
