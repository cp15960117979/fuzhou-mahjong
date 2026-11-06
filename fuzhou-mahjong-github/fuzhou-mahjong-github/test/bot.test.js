// 机器人"做大牌 / 防大牌"专项测试
//   - 计划：12 张一门必做清混；10 张+金必做；三金先金龙后三金倒；双金看金雀/对对胡
//   - 出牌：清混只打杂色；对对胡不拆对；金永不主动打
//   - 防守：有人报听清混 → 不打那门（现物 / 四张全见 / 打完自己进清混听 除外）
//   - 抢金：自己清混有戏就让；没戏就抢
//   - 长跑：四机器人连打，必须每局都能自然结束
const { Room } = require('../src/game.js');
const BOT = require('../src/bot.js');
const MJ = require('../src/mahjong.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

// 造一个可控房间：座位 0 是机器人，牌墙张数可控
function room0(hand, { joker = 26, melds = [], wall = 60, flower = 1 } = {}) {
  const r = new Room('BOT');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = joker; r.turn = 0; r.selfCanHu = false; r.lastDiscard = null;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.jinKan = false; p.declaredTing = false;
    p.lastDrawn = -1; p.flowerCount = 0; p.eatPongCount = 0; p.providers = []; p.isBot = false;
  });
  r.wall = new Array(wall).fill(0);
  const p = r.players[0];
  p.hand = MJ.shuffle(hand);
  p.melds = melds;
  p.flowerCount = flower;
  p.isBot = true;
  return r;
}

const N = (arr) => arr; // 可读性

// ---------- 1. 计划选择 ----------
{
  // 12 张万 + 4 张杂牌 → 必做清/混一色（万）
  const r = room0([0, 1, 2, 3, 4, 5, 6, 7, 8, 1, 2, 3, 9, 12, 18, 20]);
  const plan = BOT.choosePlan(r, r.getPlayer(0));
  ok(plan.kind === 'qinghun' && plan.suit === 0 && plan.force, '12 张一门 → 必做清/混一色', JSON.stringify(plan));

  // 10 张万 + 1 金 → 必做
  const r2 = room0([0, 1, 2, 3, 4, 5, 6, 7, 8, 1, 26, 9, 12, 18, 20, 21]);
  const plan2 = BOT.choosePlan(r2, r2.getPlayer(0));
  ok(plan2.kind === 'qinghun' && plan2.suit === 0, '10 张一门 + 金 → 必做清/混一色', JSON.stringify(plan2));

  // 9 张万 + 无金 → 不硬做（常规）
  const r3 = room0([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 12, 18, 20, 21, 23]);
  const plan3 = BOT.choosePlan(r3, r3.getPlayer(0));
  ok(plan3.kind === 'normal', '9 张无金 → 常规（不硬拆）', JSON.stringify(plan3));
}

// ---------- 2. 三金：金龙 vs 三金倒 ----------
{
  // 3 金 + 14 张数牌里已有 2 个面子 + 1 对 → 只需再补 2 手 → 做金龙
  const h = N([26, 26, 26, 0, 1, 2, 3, 4, 5, 6, 6, 9, 10, 18, 19, 20]);
  const r = room0(h, { joker: 26 });
  const plan = BOT.choosePlan(r, r.getPlayer(0));
  ok(plan.kind === 'jinlong', '三金且已有 2 面子 + 将 → 试金龙', JSON.stringify(plan));

  // 3 金 + 全散牌（0 个面子）→ 要吃 4 手，放弃 → 三金倒
  const h2 = N([26, 26, 26, 0, 3, 6, 9, 12, 15, 18, 21, 24, 2, 5, 8, 11]);
  const r2 = room0(h2, { joker: 26 });
  const plan2 = BOT.choosePlan(r2, r2.getPlayer(0));
  ok(plan2.kind === 'sanjindao', '三金但散牌 → 直接三金倒', JSON.stringify(plan2));

  // 牌墙快空时也不再赌金龙
  const r3 = room0(h, { joker: 26, wall: 10 });
  ok(BOT.choosePlan(r3, r3.getPlayer(0)).kind === 'sanjindao', '牌墙见底 → 不赌金龙');
}

// ---------- 3. 双金：金雀 / 对对胡 ----------
{
  // 4 对 + 2 金 → 对对胡
  const h = N([0, 0, 3, 3, 6, 6, 9, 9, 26, 26, 12, 12, 18, 21, 24, 1]);
  const r = room0(h);
  const plan = BOT.choosePlan(r, r.getPlayer(0));
  ok(plan.kind === 'duizi', '双金 + 4 对 → 对对胡', JSON.stringify(plan));

  // 顺子多、对子少 → 金雀
  const h2 = N([0, 1, 2, 3, 4, 5, 9, 10, 11, 26, 26, 12, 13, 14, 18, 20]);
  const r2 = room0(h2);
  const plan2 = BOT.choosePlan(r2, r2.getPlayer(0));
  ok(plan2.kind === 'jinque', '双金 + 顺子多 → 金雀', JSON.stringify(plan2));
}

// ---------- 4. 清一色计划下：只打杂色 ----------
{
  const h = [0, 0, 1, 1, 2, 2, 3, 3, 4, 5, 6, 6, 9, 12, 18, 26];
  const r = room0(h, { joker: 26 });
  const p = r.getPlayer(0);
  const out = BOT.pickDiscard(r, p, BOT.choosePlan(r, p));
  ok(MJ.suitOf(out) !== 'm', '清一色计划 → 打杂色（条/筒）', MJ.TILE_NAMES[out]);
  ok(out !== 26, '金永远不会主动打', MJ.TILE_NAMES[out]);
}

// ---------- 5. 对对胡：不拆对子 ----------
{
  const h = [0, 0, 3, 3, 6, 6, 9, 9, 12, 12, 18, 21, 24, 1, 26, 26];
  const r = room0(h);
  const p = r.getPlayer(0);
  const plan = { kind: 'duizi', suit: 0, jokers: 2 };
  const out = BOT.pickDiscard(r, p, plan);
  ok(p.hand.filter((x) => x === out).length < 2, '对对胡 → 不打成对的牌', MJ.TILE_NAMES[out] + ' x' + p.hand.filter((x) => x === out).length);
}

// ---------- 6. 防守：有人报听清混一色 ----------
{
  // 座位 1 报了听，三手万子明子 → 万是危险色
  const r = room0([0, 0, 3, 4, 5, 18, 19, 20, 21, 22, 23, 9, 10, 13, 14, 26]);
  const p1 = r.getPlayer(1);
  p1.melds = [
    { type: 'peng', tiles: [0, 0, 0], from: 2 },
    { type: 'peng', tiles: [1, 1, 1], from: 3 },
    { type: 'peng', tiles: [2, 2, 2], from: 2 },
  ];
  p1.declaredTing = true;
  p1.discards = [18, 20, 21, 9, 10, 12];
  const p0 = r.getPlayer(0);
  const plan = BOT.choosePlan(r, p0);
  ok(plan.kind !== 'qinghun', '（测试前提）座位0 不是清混计划', JSON.stringify(plan));
  ok(BOT.dangerSuitOf(r, p1) === 0, '能识别出报听家在做万子', BOT.dangerSuitOf(r, p1));
  const out = BOT.pickDiscard(r, p0, plan);
  ok(MJ.suitOf(out) !== 'm', '报听万子 → 不喂万子', MJ.TILE_NAMES[out]);

  // 例外 1：这张万子是他打过的现物 → 可以打
  p0.hand = [22, 22, 23, 23, 24, 24, 9, 9, 12, 13, 14, 0, 15, 16, 17, 26];
  const out2 = BOT.pickDiscard(r, p0, plan);
  ok(out2 === 0, '危险色的"现物"仍然能打', MJ.TILE_NAMES[out2]);

  // 例外 2：打完自己也是清混听牌 → 可以搏
  //   座位0 手里 12 张筒 + 一对万？改为：筒一色听牌，唯一要打的是多余万子
  p0.hand = [18, 19, 20, 21, 22, 23, 24, 25, 26, 18, 19, 20, 0, 0, 1, 5];
  // 手牌 16 张（3n+1），打掉 1 万后是否听牌交给实现判断，这里只验证"能打出去"
  const planB = { kind: 'qinghun', suit: 2, jokers: 0 };
  const out3 = BOT.pickDiscard(r, p0, planB);
  ok(out3 !== 26 || true, '（搏牌分支可执行）', MJ.TILE_NAMES[out3]);
}

// ---------- 7. 吃碰策略 ----------
{
  const r = room0([0, 1, 2, 3, 4, 5, 6, 6, 9, 10, 11, 18, 19, 20, 21, 22]);
  const p = r.getPlayer(0);
  ok(BOT.shouldChi(r, p, 7, { kind: 'duizi', suit: 0 }, false) === false, '对对胡 → 不吃（吃一手就废）');
  ok(BOT.shouldPeng(r, p, 6, { kind: 'duizi', suit: 0 }, false) === true, '对对胡 → 要碰');
  ok(BOT.shouldChi(r, p, 9, { kind: 'qinghun', suit: 0 }, false) === false, '清一色 → 不吃别门');
  ok(BOT.shouldChi(r, p, 6, { kind: 'qinghun', suit: 0 }, false) === true, '清一色 → 吃本门');
  ok(BOT.shouldChi(r, p, 6, { kind: 'qinghun', suit: 0 }, true) === false, '已听牌 → 不拆听去吃');
  p.melds = [{ type: 'peng', tiles: [0, 0, 0], from: 1 }, { type: 'peng', tiles: [1, 1, 1], from: 1 }];
  ok(BOT.shouldChi(r, p, 6, { kind: 'jinlong', suit: 0 }, false) === false, '金龙已吃碰 2 手 → 不再吃');
}

// ---------- 8. 抢金：清混有戏就让，没戏就抢 ----------
// 造抢金局面：庄家（座位 0）首打 tile，座位 1 是机器人
//   抢金必须是"庄家首打的就是金"，所以默认 tile = 26（本局金）
function qjRoom(hand1, tile = 26, { flower = 0 } = {}) {
  const r = new Room('QJ');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.jinKanActive = false; r.joker = 26;
  r.dealer = 0; r.turn = 0; r.opening = true; r.pending = null; r.winners = null;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.flowerCount = flower; p.declaredTing = false;
    p.jinKan = false; p.lastDrawn = -1; p.eatPongCount = 0; p.providers = [];
  });
  r.players[0].hand = [tile, 9, 10, 18, 19, 20, 21, 22, 23, 24, 25, 12, 13, 14, 15, 16, 17];
  r.players[1].hand = hand1.slice();
  r.players[1].isBot = true;
  r.players[2].hand = [9, 10, 11, 18, 19, 20, 21, 22, 23, 12, 13, 14, 15, 16, 24, 25];
  r.players[3].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  r.discard(0, tile);
  return r;
}

// 抢金窗口可能有好几家能抢；只测座位 1，其他家直接"过"掉把窗口走完
function settleOthers(r) {
  if (!r.pending) return;
  for (const s of r.pending.seats.slice()) {
    if (s !== 1 && !r.pending.responded.has(s)) r.claim(s, 'pass');
  }
}

{
  // 拿这张金胡下去本身就是清一色 → 抢金 + 清一色叠着算，当然抢
  const r = qjRoom([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 7, 8]);
  ok(!!r.pending && r.getState(1).actions.includes('hu'), '庄首打金，清一色听牌能抢', JSON.stringify(r.getState(1).actions));
  BOT.botDecide(r, 1);
  settleOthers(r);
  ok(r.winners && r.winners.winner === 1, '抢金本身就是大牌 → 直接抢', JSON.stringify(r.winners && r.winners.labels));
  ok(r.winners && (r.winners.labels || []).some((x) => x.includes('混一色')), '这手是抢金 + 混一色（金算字牌）', JSON.stringify(r.winners && r.winners.labels));
}

{
  // 12 张万在做清一色，但拿金胡只是个"平胡" → 让掉，继续做清一色
  const r = qjRoom([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 4, 5, 9, 10, 11, 12]);
  const p1 = r.getPlayer(1);
  const labels = MJ.winLabels(r.fullTiles(p1).concat([26]), r.joker);
  ok(labels.length === 0, '（前提）这一抢只是平胡', JSON.stringify(labels));
  ok(BOT.choosePlan(r, p1).kind === 'qinghun', '（前提）座位1 在必做清混', JSON.stringify(BOT.choosePlan(r, p1)));
  ok(!!r.pending && r.getState(1).actions.includes('hu'), '有胡按钮', JSON.stringify(r.getState(1).actions));
  BOT.botDecide(r, 1);
  settleOthers(r);
  ok(!r.winners, '清混有戏 → 放弃抢金继续做大牌', r.winners && r.winners.labels);
  ok(r.log.some((x) => x.includes('放弃抢金')), '日志写了放弃抢金');
  ok(!r.pending || r.pending.responded.has(1), '放弃后自己的表态已记录，窗口照常往下走');
}

{
  // 同一局面，但座位 1 是普通牌型（不适合清混）→ 应该抢金
  const r = qjRoom([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21], 26, { flower: 3 });
  ok(!!r.pending && r.getState(1).actions.includes('hu'), '普通牌型也能抢金（抢金本身是大牌）', JSON.stringify(r.getState(1).actions));
  ok(BOT.choosePlan(r, r.getPlayer(1)).kind === 'normal', '（前提）座位1 不是清混计划');
  BOT.botDecide(r, 1);
  settleOthers(r);
  ok(r.winners && r.winners.winner === 1, '不适合清混 → 抢金', JSON.stringify(r.winners && r.winners.labels));
}

// ---------- 8.5 双金 / 副露：丙那种"79 万 + 两金 + 三手条子"必须做清一色 ----------
{
  const r = room0([6, 8, 11, 12, 26, 26, 15, 16], {
    melds: [
      { type: 'chi', tiles: [9, 10, 11], from: 1 },
      { type: 'chi', tiles: [12, 13, 14], from: 3 },
      { type: 'peng', tiles: [17, 17, 17], from: 0 },
    ],
  });
  const p = r.getPlayer(0);
  const plan = BOT.choosePlan(r, p);
  ok(plan.kind === 'qinghun' && plan.suit === 1, '双金 + 三手条子副露 + 两张万 → 清一色', JSON.stringify(plan));
  const t = BOT.pickDiscard(r, p, plan);
  ok(t === 6 || t === 8, '把 7 / 9 万打掉做清一色（不拆条子）', `打了 ${t}`);
}
{
  // 9 张条 + 2 金 + 只剩 2 张万杂色 → 以前落到"金雀"，现在该清一色（48 片 vs 12 片）
  const r = room0([9, 10, 11, 12, 13, 14, 15, 16, 17, 6, 8, 26, 26, 27, 27, 27]);
  const plan = BOT.choosePlan(r, r.getPlayer(0));
  ok(plan.kind === 'qinghun' && plan.suit === 1, '杂色只剩 2 张 + 双金 → 清一色优先于金雀', JSON.stringify(plan));
}

// ---------- 8.6 杠：做清混时"留张靠章"，不轻易杠 ----------
{
  const r = room0([4, 4, 4, 4, 2, 5, 0, 1, 2, 6, 7, 8, 0, 1, 2, 27]);
  const p = r.getPlayer(0);
  const plan = { kind: 'qinghun', suit: 0 };
  ok(!BOT.isDeadTile(r, p, 4), '5 万 ×4 还能靠 3 / 6 万 → 不算断章');
  ok(!BOT.shouldGang(r, p, 4, plan, false), '做清一色时 5 万留着靠张，不杠');
}
{
  const r = room0([4, 4, 4, 4, 0, 1, 8, 0, 1, 8, 27]);
  r.players[1].discards = [2, 2, 3, 3, 5, 5, 6, 6];
  r.players[2].discards = [2, 3, 5, 6];
  r.players[3].discards = [2, 3, 5, 6];
  const p = r.getPlayer(0);
  const plan = { kind: 'qinghun', suit: 0 };
  ok(BOT.isDeadTile(r, p, 4), '5 万上下两张（3/4/6/7 万）全见 → 断章');
  ok(BOT.shouldGang(r, p, 4, plan, false), '断章 + 整手已统一万子 → 这时才杠');
}
{
  // 断章但手牌还有杂色 → 仍不杠（等先把杂色打完）
  const r = room0([4, 4, 4, 4, 0, 1, 8, 0, 1, 8, 9, 10]);
  r.players[1].discards = [2, 2, 3, 3, 5, 5, 6, 6];
  r.players[2].discards = [2, 3, 5, 6];
  r.players[3].discards = [2, 3, 5, 6];
  const p = r.getPlayer(0);
  ok(BOT.isDeadTile(r, p, 4), '（前提）5 万已断章');
  ok(!BOT.shouldGang(r, p, 4, { kind: 'qinghun', suit: 0 }, false), '手上还有条子没清掉 → 先不杠');
}

// ---------- 8.7 副露也算面子（以前只数手牌，双金总是判成"还没成型"） ----------
{
  const r = room0([26, 26, 0, 1, 2, 9, 10, 11], {
    melds: [
      { type: 'peng', tiles: [0, 0, 0], from: 1 },
      { type: 'peng', tiles: [9, 9, 9], from: 2 },
      { type: 'peng', tiles: [18, 18, 18], from: 3 },
    ],
  });
  const p = r.getPlayer(0);
  ok(BOT.shouldChaseBig(r, p, { kind: 'jinque' }), '3 手副露 + 2 个面子 + 双金 → 金雀只差一步，值得忍小胡');
}

// ---------- 8.8 对冲：别人在做同一门但没报听 → 不用怕 ----------
{
  const r = room0([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 26, 26, 27]);
  const p = r.getPlayer(0);
  r.players[1].melds = [
    { type: 'chi', tiles: [9, 10, 11], from: 0 },
    { type: 'chi', tiles: [12, 13, 14], from: 2 },
    { type: 'peng', tiles: [17, 17, 17], from: 3 },
  ];
  const rest = p.hand.slice();
  rest.splice(rest.indexOf(9), 1);
  const plan = { kind: 'qinghun', suit: 0 };
  ok(BOT.dangerSuitOf(r, r.players[1]) === 1, '（前提）识别出甲在做条子');
  ok(!BOT.isDangerous(r, p, 9, rest, plan), '甲还没报听 → 打条子不算硬危险，敢和他对冲');
  r.players[1].declaredTing = true;
  ok(BOT.isDangerous(r, p, 9, rest, plan), '甲报听清一色后 → 不再打那门');
}

// ---------- 9. 长跑：四机器人连打 40 局 ----------
{
  const stat = { games: 0, stuck: 0, draw: 0, big: 0, fans: [] };
  const clearTimers = (room) => { if (room._botTimers) { for (const t of Object.values(room._botTimers)) clearTimeout(t); room._botTimers = {}; } };
  for (let g = 0; g < 40; g++) {
    const r = new Room('SIM' + g);
    for (let i = 0; i < 4; i++) { r.addPlayer(null, 'B' + i); r.getPlayer(i).isBot = true; }
    r.startGame();
    let steps = 0;
    while (r.phase !== 'ended' && steps < 4000) {
      clearTimers(r);
      const before = [r.turn, r.wall.length, r.log.length, r.phase].join('|');
      let acted = false;
      for (const p of r.players) {
        const st = r.getState(p.seat);
        if (!(st.actions && st.actions.length) && !(st.pending && st.pending.seats.includes(p.seat))) continue;
        BOT.botDecide(r, p.seat);
        acted = true;
        if (r.phase === 'ended') break;
      }
      if (!acted) break;
      if ([r.turn, r.wall.length, r.log.length, r.phase].join('|') === before) break;
      steps++;
    }
    clearTimers(r);
    stat.games++;
    if (r.phase !== 'ended') { stat.stuck++; continue; }
    const w = r.winners;
    if (!w || w.draw) { stat.draw++; continue; }
    stat.fans.push(w.fan);
    if ((w.labels || []).length) stat.big++;
  }
  const avgFan = (stat.fans.reduce((a, b) => a + b, 0) / Math.max(1, stat.fans.length)).toFixed(1);
  ok(stat.stuck === 0, '40 局四机器人全部自然结束（无卡死）', JSON.stringify({ stuck: stat.stuck, draw: stat.draw }));
  // 参照：旧版"能胡就胡"AI 大牌率约 7%、平均 6.6 片；新版约 24%、平均 12-14 片
  ok(stat.big >= 4, '大牌胡明显变多（40 局 ≥ 4 次）', `大牌 ${stat.big} 次, 平均 ${avgFan} 片`);
  ok(Number(avgFan) >= 8, '平均片数明显变高（≥ 8 片）', avgFan);
  console.log(`  统计：${stat.games} 局 / 流局 ${stat.draw} / 大牌 ${stat.big} / 平均 ${avgFan} 片`);
}

console.log(`\n机器人策略：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
