// v11 测试：事件流（音效/特效的数据源）+ 快捷表情
//   引擎不再让前端"猜"发生了什么：每个动作 push 一条事件，随下一次 state 广播下发，
//   大牌胡还要带上 labels / fan / bonus，前端据此决定放什么音效、撒不撒金。
const assert = require('assert');
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

// 假 WebSocket：把收到的每条消息都存下来
function fakeWs(box) {
  return {
    readyState: 1,
    send(raw) { box.push(JSON.parse(raw)); },
  };
}

function newRoom() {
  const box = [];
  const r = new Room('V11');
  for (let i = 0; i < 4; i++) r.addPlayer(fakeWs(box), 'P' + i);
  return { r, box };
}

function eventsOf(box) {
  return box.filter((m) => m.t === 'state' && Array.isArray(m.events)).flatMap((m) => m.events);
}

// ---------- 1. 开局：发牌 + 摇骰事件 ----------
(function () {
  const { r, box } = newRoom();
  r.startGame();
  const evs = eventsOf(box);
  ok(evs.some((e) => e.ev === 'deal'), '开局下发 deal（发牌音效）');
  ok(evs.some((e) => e.ev === 'dice' && Array.isArray(e.dice) && e.dice.length === 2), '换牌摇骰下发 dice 事件（含两颗点数）');
  ok(evs.every((e) => typeof e.seq === 'number'), '每条事件都带自增 seq，前端可去重');
  // 每个 player 各收一条带事件的 state（4 条），不会同一个人收两遍
  const withEv = box.filter((m) => m.t === 'state' && Array.isArray(m.events) && m.events.length);
  ok(withEv.length === 4, '每条事件每人只下发一次（4 人 = 4 条）', String(withEv.length));
})();

// ---------- 2. 出牌事件 ----------
(function () {
  const { r, box } = newRoom();
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.joker = 26; r.dealer = 0; r.turn = 0; r.opening = false;
  r.players.forEach((p) => { p.hand = []; p.melds = []; p.discards = []; p.flowerCount = 2; p.lastDrawn = -1; });
  r.players[0].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 22, 23];
  for (let s = 1; s < 4; s++) r.players[s].hand = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24, 25, 0];
  box.length = 0;
  const res = r.discard(0, 23);
  ok(res.ok, '出牌成功');
  const evs = eventsOf(box);
  const ev = evs.find((e) => e.ev === 'discard');
  ok(!!ev && ev.seat === 0 && ev.tile === 23, '下发 discard 事件（带座位与实际打出的牌）', JSON.stringify(evs));
})();

// ---------- 3. 碰：动作事件不等同于"出牌" ----------
(function () {
  const { r, box } = newRoom();
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.joker = 26; r.dealer = 0; r.turn = 0; r.pending = null;
  r.players.forEach((p) => { p.hand = []; p.melds = []; p.discards = []; p.flowerCount = 2; p.lastDrawn = -1; p.eatPongCount = 0; });
  r.players[0].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 22, 30];
  r.players[1].hand = [30, 30, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  r.players[2].hand = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24, 25, 24];
  r.players[3].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  r.discard(0, 30);
  box.length = 0;
  const res = r.claim(1, 'peng', { tile: 30 });
  const evs = eventsOf(box);
  ok(res.ok !== false, '碰可以执行', res && res.msg);
  ok(evs.some((e) => e.ev === 'peng' && e.seat === 1), '下发 peng 事件（前端放"碰"的音，而不是出牌音）', JSON.stringify(evs));
})();

// ---------- 4. 大牌胡：事件带 labels / fan / bonus ----------
(function () {
  const { r, box } = newRoom();
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.joker = -1; r.dealer = 0; r.turn = 0; r.pending = null;
  r.players.forEach((p) => { p.hand = []; p.melds = []; p.discards = []; p.flowerCount = 1; p.lastDrawn = -1; p.declaredTing = false; p.jinKan = false; });
  // 纯清一色 + 对对胡：111 222 333 444 555 万 + 66 万
  r.players[0].hand = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5];
  r.players[1].hand = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24, 25, 26];
  r.players[2].hand = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24, 25, 26];
  r.players[3].hand = [9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 24, 25, 26];
  box.length = 0;
  const res = r.doHu(0, true, 0, {});
  ok(res.ok, '清一色对对胡可以胡', res && res.msg);
  const ev = eventsOf(box).find((e) => e.ev === 'hu');
  ok(!!ev, '下发 hu 事件');
  if (ev) {
    ok(ev.big === true, '大牌标记 big=true（前端据此放礼炮特效）');
    ok(ev.bonus >= 48, '大牌奖励分 bonus ≥ 48（清一色 48 起）', String(ev.bonus));
    ok(Array.isArray(ev.labels) && ev.labels.includes('纯清一色'), '事件带牌型标签', JSON.stringify(ev.labels));
    ok(typeof ev.fan === 'number' && ev.fan > 0, '事件带片数 fan', String(ev.fan));
    ok(ev.zimo === true, '事件带自摸标记');
  }
})();

// ---------- 5. 快捷表情：广播给全桌 + 冷却 + 白名单 ----------
(function () {
  const { r, box } = newRoom();
  r.startGame();
  box.length = 0;
  const res = r.sendEmoji(2, 'help');
  ok(res.ok, '表情发送成功');
  const got = box.filter((m) => m.t === 'emoji');
  ok(got.length === 4, '四个在线玩家都收到表情广播', String(got.length));
  ok(got[0] && got[0].seat === 2 && got[0].id === 'help', '表情带发送者座位与表情 id');
  ok(got[0] && got[0].name === 'P2', '表情带发送者昵称');

  box.length = 0;
  const again = r.sendEmoji(2, 'who');
  ok(again.ok === false, '900ms 内连发被拦（防刷屏）');
  ok(box.filter((m) => m.t === 'emoji').length === 0, '被拦的表情不会广播');
  const other = r.sendEmoji(3, 'who');
  ok(other.ok === true, '别人不受影响，可以发');

  const bad = r.sendEmoji(1, '../../etc/passwd');
  ok(bad.ok === false, '白名单外的东西发不出去');
})();

console.log(`\nv11 事件/表情：${pass} 通过 / ${fail} 失败`);
if (fail) process.exit(1);
