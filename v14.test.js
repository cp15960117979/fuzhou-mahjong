// v14 专项：暗杠遮挡、副露来源、报听门槛、听牌提示、多牌型叠加
const { Room } = require('../src/game.js');
const MJ = require('../src/mahjong.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) pass++;
  else { fail++; console.log('✗', name, extra == null ? '' : '→ ' + extra); }
}
function eq(a, b, name) { ok(a === b, name, `期望 ${b}，实际 ${a}`); }

function mockWs(tag) {
  return { tag, seat: null, pid: null, roomId: null, send() {}, readyState: 1, close() {} };
}

function base(joker = 8) {
  const r = new Room('V14');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.pending = null;
  r.winners = null; r.joker = joker; r.turn = 0; r.jinKanActive = false;
  r.selfCanHu = false; r.selfNeedTing = false; r.lastDiscard = null;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.flowerCount = 5;
    p.jinKan = false; p.declaredTing = false; p.eatPongCount = 0; p.providers = [];
    p.lastDrawn = -1; p.gangDraw = false; p.score = 0;
  });
  return r;
}

// 4 组筒子碰 + 5 张暗牌（含金）= 17 张的混一色成牌
function qingHunHand(r) {
  const p = r.getPlayer(0);
  p.melds = [
    { type: 'peng', tiles: [18, 18, 18], from: 0 },
    { type: 'peng', tiles: [19, 19, 19], from: 1 },
    { type: 'peng', tiles: [25, 25, 25], from: 0 },
    { type: 'peng', tiles: [26, 26, 26], from: 3 },
  ];
  p.hand = [21, 22, 8, 24, 24];   // 21 22 金(23) 成顺 + 24 24 作将
  p.eatPongCount = 4;
  p.lastDrawn = 24;
  return p;
}

/* ---------------- 暗杠：别人 4 张背面，自己 3 背 + 1 亮 ---------------- */
{
  const r = base(8);
  const p = r.getPlayer(1);
  p.melds = [{ type: 'angang', tiles: [4, 4, 4, 4], from: -1 }];

  const selfView = r.getState(1).players[1].melds[0];
  ok(selfView.selfConcealed === true, '自己的暗杠：标 selfConcealed');
  eq(selfView.tiles.length, 4, '自己的暗杠：牌面仍下发（自己看一张）');
  ok(selfView.hidden == null, '自己的暗杠：不算隐藏');

  const otherView = r.getState(0).players[1].melds[0];
  eq(otherView.hidden, 4, '别人的暗杠：只给 4 张背面');
  eq(otherView.tiles.length, 0, '别人的暗杠：一张牌面都不下发');

  r.phase = 'ended';
  const reveal = r.getState(0).players[1].melds[0];
  ok(reveal.hidden == null && reveal.tiles.length === 4, '结算时暗杠全部亮出');
}

/* ---------------- 副露来源：吃碰杠记下是哪张、谁打的 ---------------- */
{
  const r = base(8);
  r.turn = 1;
  const p1 = r.getPlayer(1);
  p1.discards = [4];                    // 一万
  const p2 = r.getPlayer(2);
  p2.hand = [4, 4, 23, 24];

  r.doPeng(2, 4, 1);
  const m = r.getPlayer(2).melds[0];
  eq(m.type, 'peng', '碰成立');
  eq(m.claim, 4, '副露记下被碰的那张牌');
  eq(m.from, 1, '副露记下来源座位');

  const st = r.getState(0).players[2].melds[0];
  eq(st.claim, 4, '状态里带 claim，前端能显示"碰的是哪张"');
  eq(st.from, 1, '状态里带 from，前端能显示"谁喂的"');
}

/* ---------------- 报听门槛：清/混一色吃碰满 3 手 ---------------- */
{
  const r = base(8);
  const p = qingHunHand(r);
  ok(r.checkWinOf(p).win, '（前提）这手 17 张确实成牌');
  ok(r.selfHu(0).ok === false, '没报听 → 自摸也不能胡');
  ok(!r.getState(0).actions.includes('hu'), '没报听 → 不出「胡」按钮');
  ok(r.getState(0).players[0].needTing === true, '状态告诉前端"这手要报听"');

  ok(r.declareTing(0).ok, '自己回合可以宣告听牌');
  ok(r.getPlayer(0).declaredTing === true, '报听标记生效');
  ok(r.getState(0).actions.includes('hu'), '报听后出现「胡」按钮');
  ok(r.selfHu(0).ok, '报听后可以自摸胡');
}

/* ---------------- 报听门槛：杠上开花例外 ---------------- */
{
  const r = base(8);
  const p = qingHunHand(r);
  p.gangDraw = true;                    // 这张是杠后补摸的
  ok(r.selfHu(0).ok, '杠上开花（补摸的这张）不用报听也能胡');
}

/* ---------------- 报听门槛：点炮也拦 ---------------- */
{
  const r = base(8);
  const p = r.getPlayer(2);
  p.melds = [
    { type: 'peng', tiles: [18, 18, 18], from: 0 },
    { type: 'peng', tiles: [19, 19, 19], from: 1 },
    { type: 'peng', tiles: [25, 25, 25], from: 0 },
    { type: 'peng', tiles: [26, 26, 26], from: 3 },
  ];
  p.hand = [21, 22, 8, 24];             // 16 张：21 22 金(23) + 24 单钓
  p.eatPongCount = 4;

  ok(r.ronNeedTing(p, 24) === true, '能胡但没报听 → ronNeedTing 为真');
  ok(r.canRon(p, 24) === false, '没报听 → 别人打的这张不能胡');
  p.declaredTing = true;
  ok(r.canRon(p, 24) === true, '报听后 → 可以点炮胡');
}

/* ---------------- 报听门槛：不足 3 手不拦 ---------------- */
{
  const r = base(8);
  const p = r.getPlayer(0);
  p.melds = [
    { type: 'peng', tiles: [18, 18, 18], from: 0 },
    { type: 'peng', tiles: [19, 19, 19], from: 1 },
  ];
  p.hand = [21, 22, 23, 24, 25, 26, 8, 8, 25, 25]; // 8 张暗牌 + 2 组副露
  p.eatPongCount = 2;
  // 只是验证门槛：没报听也允许胡（能不能成牌由 checkWin 判定）
  ok(r.tingRequired(p, { feats: { hunyise: true } }, {}) === false, '只有 2 手 → 不需要报听');
}

/* ---------------- 点炮窗口：needTing 提示 ---------------- */
{
  const r = base(8);
  const p2 = r.getPlayer(2);
  p2.melds = [
    { type: 'peng', tiles: [18, 18, 18], from: 0 },
    { type: 'peng', tiles: [19, 19, 19], from: 1 },
    { type: 'peng', tiles: [25, 25, 25], from: 0 },
    { type: 'peng', tiles: [26, 26, 26], from: 3 },
  ];
  p2.hand = [21, 22, 8, 24];
  p2.eatPongCount = 4;

  r.turn = 1;
  r.getPlayer(1).hand = [24, 5, 6, 7];
  r.getPlayer(0).hand = [24, 24, 0, 1];   // 能碰，保证窗口不会直接跳过
  const d = r.discard(1, 24);
  ok(d.ok, '（前提）P1 打出 24');
  ok(r.pending && (r.pending.needTing || []).includes(2), '点炮窗口把"没报听"的家单独列出来');
  ok(!r.pending.seats.includes(2), '没报听的人不进响应名单（点了也不能胡）');
  ok((r.getState(2).pending.needTing || []).includes(2), '前端能读到 needTing，弹出原因提示');
}

/* ---------------- 报听后：高亮"打哪张能听牌" ---------------- */
{
  const r = base(8);
  const p = r.getPlayer(0);
  p.melds = [
    { type: 'peng', tiles: [18, 18, 18], from: 0 },
    { type: 'peng', tiles: [19, 19, 19], from: 1 },
    { type: 'peng', tiles: [25, 25, 25], from: 0 },
    { type: 'peng', tiles: [26, 26, 26], from: 3 },
  ];
  p.hand = [21, 22, 8, 24, 16];            // 16 = 八条，唯一的杂色
  p.eatPongCount = 4;
  p.declaredTing = true;
  r.turn = 0;

  const picks = r.tingDiscards(p);
  ok(picks.includes(16), '打掉杂色八条 → 进混一色听牌，要高亮');
  ok(!picks.includes(21), '打筒子会拆牌，不该高亮');

  p.declaredTing = false;
  eq(r.tingDiscards(p).length, 0, '没报听时不给听牌高亮');
}

/* ---------------- 多牌型：金雀走不通时，仍按混一色胡 ---------------- */
{
  const r = base(8);
  const p = r.getPlayer(0);
  p.melds = [
    { type: 'peng', tiles: [18, 18, 18], from: 0 },
    { type: 'peng', tiles: [19, 19, 19], from: 1 },
    { type: 'peng', tiles: [25, 25, 25], from: 0 },
    { type: 'peng', tiles: [26, 26, 26], from: 3 },
  ];
  p.hand = [21, 22, 8, 8, 24];             // 双金 + 21 22 24：双金作将时凑不出面子
  const w = r.checkWinOf(p);
  ok(w.win, '双金拆开补面子 → 仍然能胡（不再"金雀走不通就胡不了"）');
  ok(w.feats.hunyise === true, '这手算混一色');
  ok(w.feats.jinque === false, '这手不是金雀（金被拆去补顺子）');

  const labels = MJ.labelsOf(w);
  ok(labels.includes('混一色'), '按钮标签里有「混一色」', JSON.stringify(labels));
  ok(!labels.includes('金雀'), '不会硬塞一个走不通的「金雀」', JSON.stringify(labels));
}

/* ---------------- 多牌型：金雀和混一色可以同时成立 ---------------- */
{
  const r = base(8);
  const p = r.getPlayer(0);
  p.melds = [
    { type: 'peng', tiles: [18, 18, 18], from: 0 },
    { type: 'peng', tiles: [19, 19, 19], from: 1 },
    { type: 'peng', tiles: [25, 25, 25], from: 0 },
    { type: 'peng', tiles: [26, 26, 26], from: 3 },
  ];
  p.hand = [21, 22, 23, 8, 8];             // 21 22 23 成顺 + 双金作将
  const w = r.checkWinOf(p);
  ok(w.win && w.feats.jinque, '双金作将 + 筒子顺子 → 金雀成立');
  ok(w.feats.hunyise, '同时还是混一色');
  const labels = MJ.labelsOf(w);
  ok(labels.includes('金雀') && labels.includes('混一色'), '两个牌型都显示出来', JSON.stringify(labels));
}

/* ---------------- 多牌型点炮：金雀（双金作将）也要能胡下去 ---------------- */
{
  const r = base(8);
  const p2 = r.getPlayer(2);
  p2.melds = [
    { type: 'peng', tiles: [18, 18, 18], from: 0 },
    { type: 'peng', tiles: [19, 19, 19], from: 1 },
    { type: 'peng', tiles: [25, 25, 25], from: 0 },
    { type: 'peng', tiles: [26, 26, 26], from: 3 },
  ];
  p2.hand = [21, 22, 8, 8];        // 21 22 + 金(23) 成顺，双金作将 → 金雀
  p2.eatPongCount = 4;
  p2.declaredTing = true;          // 混一色 + 吃碰 4 手，已经报过听
  r.turn = 1;
  r.getPlayer(1).hand = [23, 5, 6, 7];
  r.getPlayer(0).hand = [23, 23, 0, 1];   // 保证别的家也有反应，窗口不会直接跳过

  ok(r.canRon(p2, 23) === true, '金雀听牌：别人打出 23 能胡（不再只能吃碰或过）');
  const w = r.checkWinOf(p2, [23], { sanjindao: false });
  const labels = MJ.labelsOf(w);
  ok(w.win && w.feats.jinque && w.feats.hunyise, '金雀 + 混一色同时成立');
  ok(labels.includes('金雀') && labels.includes('混一色'), '按钮标签把两个牌型都列出来', JSON.stringify(labels));

  const d = r.discard(1, 23);
  ok(d.ok, '（前提）P1 打出 23');
  const entry = (r.pending.acts || []).find((x) => x.seat === 2);
  ok(entry && entry.acts.includes('hu'), '金雀那家在窗口里拿到「胡」按钮', JSON.stringify(entry && entry.acts));
}

/* ---------------- 多牌型点炮：金雀走不通 → 退回混一色照样能胡 ---------------- */
{
  const r = base(8);
  const p2 = r.getPlayer(2);
  p2.melds = [
    { type: 'peng', tiles: [18, 18, 18], from: 0 },
    { type: 'peng', tiles: [19, 19, 19], from: 1 },
    { type: 'peng', tiles: [25, 25, 25], from: 0 },
    { type: 'peng', tiles: [26, 26, 26], from: 3 },
  ];
  p2.hand = [20, 8, 24, 24];       // 20 金 22 成顺（金补 21），24 24 作将 → 不是金雀，是混一色
  p2.eatPongCount = 4;
  p2.declaredTing = true;
  r.turn = 1;

  ok(r.canRon(p2, 22) === true, '金雀走不通时，混一色照样能点炮胡');
  const labels = MJ.labelsOf(r.checkWinOf(p2, [22], { sanjindao: false }));
  ok(labels.includes('混一色') && !labels.includes('金雀'), '只给走得通的那几个牌型按钮', JSON.stringify(labels));
}

console.log(`\nv14 专项：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
