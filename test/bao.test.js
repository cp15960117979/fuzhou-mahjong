/**
 * 包牌分摊测试（清/混一色）
 *
 * 规则口径（与玩家确认过）：
 *   - 只有清一色 / 混一色才可能包牌，且要有来源的副露 ≥ 3 手
 *   - 先看"最后一手是谁喂的"，再看这个人一共喂了几手
 *   - 自摸：这个人喂满 3 手 → 付一半；喂满 4 手 → 全包
 *   - 点炮：喂牌的人在 3 手时照常付 1/4，不额外承担；4 手全同一人且不是放炮者时才分担一半
 *   - 总额恒为 3 倍单份，任何分支都不许凭空多收
 */
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}
function eq(a, b, name) {
  ok(Math.abs(a - b) < 1e-9, name, `期望 ${b}，实际 ${a}`);
}

// 万子：副露 123 / 234 / 345，暗牌 567 + 678 + 将 8，听 8
const MELDS = [
  { type: 'chi', tiles: [0, 1, 2], from: 0 },
  { type: 'chi', tiles: [1, 2, 3], from: 0 },
  { type: 'chi', tiles: [2, 3, 4], from: 0 },
];

function setup(turn) {
  const r = new Room('B');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = 26; r.turn = turn;
  r.selfCanHu = false; r.lastDiscard = null;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.jinKan = false; p.declaredTing = false;
    p.lastDrawn = -1; p.flowerCount = 2; p.eatPongCount = 0; p.providers = []; p.score = 0;
  });
  return r;
}

// 点炮：B(1) 听 winTile，fromSeat 打出它
function ron(providers, fromSeat, melds = MELDS, hand = [5, 6, 7, 6, 7, 8, 8], winTile = 8) {
  const r = setup(fromSeat);
  const B = r.getPlayer(1);
  B.melds = melds.map((m) => ({ type: m.type, tiles: m.tiles.slice(), from: m.from }));
  B.hand = hand.slice();
  B.providers = providers.slice();
  B.eatPongCount = providers.length;
  const C = r.getPlayer(fromSeat);
  C.hand = [winTile, 20, 21, 22, 24];
  const d = r.discard(fromSeat, winTile);
  if (!d || d.ok === false) throw new Error('discard 失败: ' + JSON.stringify(d));
  const h = r.claim(1, 'hu');
  if (!h || h.ok === false) throw new Error('胡牌失败: ' + JSON.stringify(h));
  return r.winners;
}

// 自摸：B(1) 摸到 winTile
function zimo(providers, melds = MELDS, hand = [5, 6, 7, 6, 7, 8, 8, 8], winTile = 8) {
  const r = setup(1);
  const B = r.getPlayer(1);
  B.melds = melds.map((m) => ({ type: m.type, tiles: m.tiles.slice(), from: m.from }));
  B.hand = hand.slice();
  B.providers = providers.slice();
  B.eatPongCount = providers.length;
  B.lastDrawn = winTile;
  const h = r.selfHu(1);
  if (!h || h.ok === false) throw new Error('自摸失败: ' + JSON.stringify(h));
  return r.winners;
}

// 5 组副露的清一色：123×3 + 345×2，手里 6 单吊 6（副露上限 5 组，容易踩到"最后一手"取错）
const MELDS5 = [
  { type: 'chi', tiles: [0, 1, 2], from: 0 },
  { type: 'chi', tiles: [0, 1, 2], from: 0 },
  { type: 'chi', tiles: [0, 1, 2], from: 0 },
  { type: 'chi', tiles: [3, 4, 5], from: 0 },
  { type: 'chi', tiles: [3, 4, 5], from: 0 },
];

const amt = (w, seat) => {
  const x = (w.payers || []).find((p) => p.seat === seat);
  return x ? x.amount : 0;
};
const sumPay = (w) => (w.payers || []).reduce((s, x) => s + x.amount, 0);

// 每局都要验的守恒：付出总额 = 应收，四家增减合计 = 0
function checkBalance(w, label) {
  eq(sumPay(w), w.fan * 3, `${label}：付出总额 = 3×片数`);
  const dsum = Object.values(w.deltas || {}).reduce((s, v) => s + v, 0);
  eq(dsum, 0, `${label}：四家增减合计为 0`);
  eq(w.deltas[1], w.fan * 3, `${label}：赢家实收 = 3×片数`);
}

// ---------- 点炮 ----------
{
  // A 喂 3 手，C 放炮 → C 一半，A 与无关的 D 各 1/4（喂牌人在点炮时不额外承担）
  const w = ron([0, 0, 0], 2);
  const f = w.fan;
  eq(amt(w, 2), f * 1.5, '点炮 3 手全 A：放炮者付一半');
  eq(amt(w, 0), f * 0.75, '点炮 3 手全 A：喂牌者只付 1/4');
  eq(amt(w, 3), f * 0.75, '点炮 3 手全 A：无关者付 1/4');
  checkBalance(w, '点炮 3 手全 A');
}

{
  // 4 手全 A 喂，C 放炮 → A 与 C 各一半，D 不出
  const w = ron([0, 0, 0, 0], 2);
  const f = w.fan;
  eq(amt(w, 2), f * 1.5, '点炮 4 手全 A：放炮者一半');
  eq(amt(w, 0), f * 1.5, '点炮 4 手全 A：喂牌者一半');
  eq(amt(w, 3), 0, '点炮 4 手全 A：第三人不出');
  checkBalance(w, '点炮 4 手全 A');
}

{
  // 4 手全 A 喂，A 自己放炮 → 全包
  const w = ron([0, 0, 0, 0], 0);
  const f = w.fan;
  eq(amt(w, 0), f * 3, '点炮 4 手全 A + A 放炮：全包');
  eq(amt(w, 2), 0, '点炮 4 手全 A + A 放炮：别的家不出');
  eq(amt(w, 3), 0, '点炮 4 手全 A + A 放炮：第三人不出');
  checkBalance(w, '点炮 4 手全 A + A 放炮');
}

{
  // 4 手来自不同人，C 放炮 → 没人喂满，放炮者全包
  const w = ron([0, 3, 2, 2], 2);
  const f = w.fan;
  eq(amt(w, 2), f * 3, '点炮 4 手不同人：放炮者全包');
  eq(amt(w, 0), 0, '点炮 4 手不同人：喂牌者不出');
  eq(amt(w, 3), 0, '点炮 4 手不同人：第三人不出');
  checkBalance(w, '点炮 4 手不同人');
}

// ---------- 自摸 ----------
{
  // 3 手全 A 喂 → A 一半，其余各 1/4
  const w = zimo([0, 0, 0]);
  const f = w.fan;
  eq(amt(w, 0), f * 1.5, '自摸 3 手全 A：喂牌者包一半');
  eq(amt(w, 2), f * 0.75, '自摸 3 手全 A：另一家 1/4');
  eq(amt(w, 3), f * 0.75, '自摸 3 手全 A：第三家 1/4');
  checkBalance(w, '自摸 3 手全 A');
}

{
  // 3 手来自三家 → 喂第 3 手的人一半
  const w = zimo([0, 3, 2]);
  const f = w.fan;
  eq(amt(w, 2), f * 1.5, '自摸 3 手不同人：喂最后一手的人包一半');
  eq(amt(w, 0), f * 0.75, '自摸 3 手不同人：第一家 1/4');
  eq(amt(w, 3), f * 0.75, '自摸 3 手不同人：第二家 1/4');
  checkBalance(w, '自摸 3 手不同人');
}

{
  // 4 手全 A 喂 → 全包，另外两家一分不出（修复点：曾经还多收两家 1/4）
  const w = zimo([0, 0, 0, 0]);
  const f = w.fan;
  eq(amt(w, 0), f * 3, '自摸 4 手全 A：喂牌者全包');
  eq(amt(w, 2), 0, '自摸 4 手全 A：第二家不出');
  eq(amt(w, 3), 0, '自摸 4 手全 A：第三家不出');
  checkBalance(w, '自摸 4 手全 A');
}

{
  // 4 手 A/A/D/D → 最后一手是 D，D 一半，另外两家 1/4
  const w = zimo([0, 0, 3, 3]);
  const f = w.fan;
  eq(amt(w, 3), f * 1.5, '自摸 A/A/D/D：喂最后一手的人包一半');
  eq(amt(w, 0), f * 0.75, '自摸 A/A/D/D：第一家 1/4');
  eq(amt(w, 2), f * 0.75, '自摸 A/A/D/D：第三家 1/4');
  checkBalance(w, '自摸 A/A/D/D');
}

// ---------- 不该触发包牌的场合 ----------
{
  const r = setup(1);
  const w = r.getPlayer(1);
  w.providers = [0, 0, 0];
  // 不是清/混一色：三家各付单份
  const pay = r.spreadDaluan(50, true, null, false, w);
  eq(pay.reduce((s, x) => s + x.amount, 0), 150, '非清混不包：总额仍是 150');
  ok(pay.every((x) => x.amount === 50), '非清混不包：三家各付 50');
}
{
  const r = setup(1);
  const w = r.getPlayer(1);
  w.providers = [0, 0];
  // 清一色但只有 2 手：不触发
  const pay = r.spreadDaluan(50, true, null, true, w);
  ok(pay.length === 3 && pay.every((x) => x.amount === 50), '不足 3 手不包：三家各付 50');
}

// ---------- 5 组副露：最后一手必须取数组末位，不能写死 provs[3] ----------
{
  const w = zimo([0, 0, 0, 0, 0], MELDS5, [6, 6], 6);
  const f = w.fan;
  eq(amt(w, 0), f * 3, '5 手全 A 自摸：喂牌者全包');
  eq(amt(w, 2), 0, '5 手全 A 自摸：第二家不出');
  eq(amt(w, 3), 0, '5 手全 A 自摸：第三家不出');
  checkBalance(w, '5 手全 A 自摸');
}

{
  // 第 4 手和第 5 手故意不是同一个人，才能测出"最后一手取错位"
  const w = zimo([0, 0, 2, 2, 3], MELDS5, [6, 6], 6);
  const f = w.fan;
  eq(amt(w, 3), f * 1.5, '5 手最后一手是 D：D 半包');
  eq(amt(w, 0), f * 0.75, '5 手最后一手是 D：A 1/4');
  eq(amt(w, 2), f * 0.75, '5 手最后一手是 D：C 只付 1/4');
  checkBalance(w, '5 手最后一手是 D');
}

{
  const w = ron([0, 0, 0, 0, 0], 2, MELDS5, [6], 6);
  const f = w.fan;
  eq(amt(w, 2), f * 1.5, '5 手全 A + C 放炮：放炮者一半');
  eq(amt(w, 0), f * 1.5, '5 手全 A + C 放炮：喂牌者一半');
  eq(amt(w, 3), 0, '5 手全 A + C 放炮：第三人不出');
  checkBalance(w, '5 手全 A + C 放炮');
}

// ---------- 分数累计必须与账单一致 ----------
{
  const w = zimo([0, 0, 0, 0]);
  const f = w.fan;
  eq(w.deltas[0], -f * 3, '自摸 4 手全 A：喂牌者分数正好减 3×片数');
  eq(w.deltas[2], 0, '自摸 4 手全 A：第二家分数不动');
  eq(w.deltas[3], 0, '自摸 4 手全 A：第三家分数不动');
}

console.log(`包牌分摊：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
