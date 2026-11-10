// 抢杠测试：别人加杠时，若你能用这张牌凑成"有奖励的大牌"，可以抢杠胡
//   - 只有大牌能抢（小胡不能抢，与"小胡不能点炮"同一口径）
//   - 抢杠优先：抢成功则杠不成立（副露仍是碰），第 4 张归胡家
//   - 没人抢 → 杠照常成立，补摸一张
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

// 通用房间：座位 0 手里有「碰 + 第 4 张」，等着加杠
//   gangTile 是加杠的那张；seat1Hand 是座位 1 的手牌（16 张，未摸牌状态）
function setup(gangTile, seat1Hand, { seat1Flower = 0 } = {}) {
  const r = new Room('Q');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = 26; r.turn = 0; r.selfCanHu = false;
  r.lastDiscard = null;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.jinKan = false;
    p.declaredTing = false; p.lastDrawn = -1; p.flowerCount = 0; p.eatPongCount = 0;
    p.providers = [];
  });
  // 座位 0：碰了 gangTile，手里留第 4 张（摸牌后 14 张）
  r.players[0].melds = [{ type: 'peng', tiles: [gangTile, gangTile, gangTile], from: 1 }];
  r.players[0].hand = [gangTile, 5, 5, 9, 10, 11, 13, 13, 18, 19, 20, 35, 35, 36];
  // 座位 1：看情况是"大牌听牌"或"小胡听牌"
  r.players[1].hand = seat1Hand.slice();
  r.players[1].flowerCount = seat1Flower;
  // 座位 2/3：杂牌，抢不了
  const junk = [9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22, 23, 35, 36, 37, 38];
  r.players[2].hand = junk.slice();
  r.players[3].hand = junk.slice();
  return r;
}

// 清一色听 3 万（加到 3 万即 000 111 222 345 678 + 77）
const QINGYISE_WAIT_3 = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 4, 5, 6, 7, 8];

// 1) 有人做的是有奖励的大牌 → 加杠先开抢杠窗口，杠暂不成立
{
  const r = setup(3, QINGYISE_WAIT_3);
  const p0 = r.getPlayer(0);
  const wallBefore = r.wall.length;
  ok(r.canRon(r.getPlayer(1), 3, false), '座位1 用 3 万能凑成清一色大牌', JSON.stringify(r.getPlayer(1).hand));
  ok(r.robKongSeats(0, 3).includes(1), '座位1 在可抢杠名单里', JSON.stringify(r.robKongSeats(0, 3)));
  const res = r.buGang(0, 3);
  ok(res && res.ok, '加杠请求被受理（转成抢杠窗口）', JSON.stringify(res));
  ok(!!r.pending && r.pending.kind === 'qianggang', '开出抢杠窗口', r.pending && r.pending.kind);
  ok(p0.melds[0].type === 'peng' && p0.melds[0].tiles.length === 3, '杠还没成立（仍是碰）', JSON.stringify(p0.melds[0]));
  ok(p0.hand.includes(3), '第 4 张还在杠家手里，等别人决定', p0.hand);
  ok(r.wall.length === wallBefore, '还没补摸（杠未成立不补牌）', r.wall.length);
  ok(r.log.some((x) => x.includes('抢杠')), '日志提示有人可抢杠');
  ok(r.getState(1).actions.includes('hu'), '可抢杠的家看到"胡"按钮', JSON.stringify(r.getState(1).actions));
  ok(r.getState(1).actions.includes('pass'), '也可以选择"过"');
  ok(r.getState(0).actions.length === 0, '杠家此时只能等', JSON.stringify(r.getState(0).actions));
  ok(r.getState(2).actions.length === 0, '抢不了的家没有按钮');
  ok(r.getState(1).pending.kind === 'qianggang', '前端能知道这是抢杠窗口');
}

// 2) 抢杠成功：杠作废、第 4 张归胡家，按点炮（杠家）结算
{
  const r = setup(3, QINGYISE_WAIT_3);
  r.buGang(0, 3);
  const res = r.claim(1, 'hu');
  ok(res && res.ok !== false, '抢杠胡成功', JSON.stringify(res));
  const w = r.winners;
  ok(w && !w.draw, '本局结束并有人胡');
  ok(w.winner === 1, '座位1 胡', w.winner);
  ok(w.from === 0, '算杠家点炮', w.from);
  ok(w.qianggang === true, '标记为抢杠胡', w.qianggang);
  ok(w.detail && w.detail.some((d) => d.includes('纯清一色')), '大牌奖励照给（纯清一色）', JSON.stringify(w.detail));
  ok(r.getPlayer(0).melds[0].type === 'peng', '杠没成立，副露仍是碰', JSON.stringify(r.getPlayer(0).melds[0]));
  ok(!r.getPlayer(0).hand.includes(3), '第 4 张被胡家拿走', r.getPlayer(0).hand);
  ok(r.getPlayer(0).hand.length === 13, '杠家手牌少一张（没补牌）', r.getPlayer(0).hand.length);
  ok(w.payers.length === 3, '三家分摊（与点炮同口径）', JSON.stringify(w.payers));
  ok(r.log.some((x) => x.includes('抢杠胡')), '日志写了抢杠胡');
  ok(r.getState(1).winners.qianggang === true, '前端能拿到抢杠标记');
}

// 3) 没人抢（都过）→ 杠照常成立，补摸一张
{
  const r = setup(3, QINGYISE_WAIT_3);
  const p0 = r.getPlayer(0);
  r.wall.push(11);
  const wallBefore = r.wall.length;
  r.buGang(0, 3);
  ok(!!r.pending, '先开抢杠窗口');
  r.claim(1, 'pass');
  ok(!r.pending, '窗口关闭', !!r.pending);
  ok(p0.melds[0].type === 'gang' && p0.melds[0].tiles.length === 4, '杠正常成立', JSON.stringify(p0.melds[0]));
  ok(p0.melds[0].bugang === true, '仍是"加杠"标记');
  ok(!p0.hand.includes(3), '第 4 张被用掉', p0.hand);
  ok(r.wall.length === wallBefore - 1, '补摸了一张', r.wall.length);
  ok(r.phase === 'playing', '对局继续', r.phase);
  ok(r.turn === 0, '还是杠家出牌', r.turn);
}

// 4) 小胡不能抢杠：加杠直接成立，没有抢杠窗口
{
  // 混花色普通牌型：123万 456万 123条 456条 123筒 + 单张4筒，摸到 4筒 成普通小胡
  const xiaohu = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 18, 19, 20, 21];
  const r = setup(21, xiaohu, { seat1Flower: 1 });
  const p1 = r.getPlayer(1);
  ok(!r.canRon(p1, 21, false), '这手只是小胡，不能点炮', JSON.stringify(p1.hand));
  ok(r.robKongSeats(0, 21).length === 0, '可抢杠名单为空', JSON.stringify(r.robKongSeats(0, 21)));
  r.wall.push(11);
  const res = r.buGang(0, 21);
  ok(res && res.ok, '加杠直接成立', JSON.stringify(res));
  ok(!r.pending, '没有开抢杠窗口', !!r.pending);
  ok(r.getPlayer(0).melds[0].type === 'gang', '副露已是 4 张杠', JSON.stringify(r.getPlayer(0).melds[0]));
}

// 5) 抢杠窗口里只能"胡 / 过"，不能碰/吃/杠
{
  const r = setup(3, QINGYISE_WAIT_3);
  r.buGang(0, 3);
  const bad = r.claim(1, 'peng');
  ok(bad && bad.ok === false && bad.msg.includes('抢杠'), '抢杠窗口拒绝碰', JSON.stringify(bad));
  ok(!!r.pending, '窗口还在');
}

// 6) 抢杠胡的人手牌不齐（少一张）→ 不判胡，窗口里就不给胡
{
  const r = setup(3, QINGYISE_WAIT_3.slice(0, 15)); // 少一张
  ok(!r.canRon(r.getPlayer(1), 3, false), '少一张不能抢杠胡', r.getPlayer(1).hand.length + 1);
  ok(r.robKongSeats(0, 3).length === 0, '少牌的人不在可抢名单');
}

// 7) 两家同时能抢 → 按轮次从杠家下家起算，先轮到谁谁胡
{
  const r = setup(3, QINGYISE_WAIT_3);
  r.getPlayer(2).hand = QINGYISE_WAIT_3.slice(); // 座位 1、2 都能抢
  r.buGang(0, 3);
  ok(r.pending.seats.length === 2, '两家都在窗口里', JSON.stringify(r.pending.seats));
  r.claim(2, 'hu'); r.claim(1, 'hu');
  ok(r.winners.winner === 1, '按轮次座位1先胡（下家优先）', r.winners.winner);
}

// 8) 金坎生效中不能抢杠（全场只能自摸）
{
  const r = setup(3, QINGYISE_WAIT_3);
  r.jinKanActive = true;
  ok(r.robKongSeats(0, 3).length === 0, '金坎中没人能抢杠');
  const res = r.buGang(0, 3);
  ok(res && res.ok === false && res.msg.includes('金坎'), '金坎中不能加杠（本来也不允许）', JSON.stringify(res));
}

// 9) 抢杠后牌数自洽：胡家 17 张、杠家 13 张、副露 3 张，没有人少牌
{
  const r = setup(3, QINGYISE_WAIT_3);
  r.buGang(0, 3);
  r.claim(1, 'hu');
  const w = r.getPlayer(1);
  const total = w.hand.length + w.melds.reduce((s, m) => s + m.tiles.length, 0) + 1;
  ok(total === 17, '胡家手牌 + 副露 + 抢来的那张 = 17', total);
}

// 10) 机器人也会抢杠（能胡就胡）
{
  const { botDecide } = require('../src/bot.js');
  const r = setup(3, QINGYISE_WAIT_3);
  r.getPlayer(1).isBot = true;
  r.buGang(0, 3);
  botDecide(r, 1);
  ok(r.winners && r.winners.winner === 1 && r.winners.qianggang === true, '机器人抢杠胡', JSON.stringify(r.winners && r.winners.qianggang));
}

// 11) 抢杠窗口超时不表态 → 自动过，杠照常成立（不卡局）
{
  const r = setup(3, QINGYISE_WAIT_3);
  r.buGang(0, 3);
  const pend = r.pending;
  ok(!!pend, '窗口已开');
  // 手动模拟超时处理（与 armPendingTimeout 内部一致）
  r.pending.responded.add(1);
  r.finishClaims();
  ok(!r.pending && r.getPlayer(0).melds[0].type === 'gang', '超时过后杠正常成立', r.getPlayer(0).melds[0].type);
}

// 12) 抢杠 + 清一色包牌：钱要落到真人座位上（不能出现 undefined）
{
  const r = new Room('Q2');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = 26; r.turn = 0; r.selfCanHu = false; r.lastDiscard = null;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.jinKan = false; p.declaredTing = false;
    p.lastDrawn = -1; p.flowerCount = 0; p.eatPongCount = 0; p.providers = [];
  });
  // 杠家：碰了八万(7)，手里留第 4 张
  r.getPlayer(0).melds = [{ type: 'peng', tiles: [7, 7, 7], from: 1 }];
  r.getPlayer(0).hand = [7, 5, 5, 9, 10, 11, 13, 13, 18, 19, 20, 35, 35, 36];
  // 抢杠家：清一色 + 3 手副露（3 家喂牌 → 包牌）
  const w1 = r.getPlayer(1);
  w1.melds = [
    { type: 'peng', tiles: [0, 0, 0], from: 0 },
    { type: 'peng', tiles: [1, 1, 1], from: 2 },
    { type: 'peng', tiles: [2, 2, 2], from: 3 },
  ];
  w1.hand = [3, 3, 3, 4, 5, 6, 7];
  w1.providers = [0, 2, 3];
  r.getPlayer(2).hand = [9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22, 23, 35, 36, 37, 38];
  r.getPlayer(3).hand = [9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22, 23, 35, 36, 37, 38];
  ok(r.canRon(w1, 7, false), '清一色 + 3 副露 抢杠成立');
  r.buGang(0, 7);
  r.claim(1, 'hu');
  const w = r.winners;
  ok(w && w.winner === 1, '抢杠胡成立');
  const seats = (w.payers || []).map((p) => p.seat);
  ok(seats.every((s) => typeof s === 'number' && s >= 0 && s < 4), '每家付款人都是有效座位', JSON.stringify(seats));
  const sum = (w.payers || []).reduce((s, p) => s + p.amount, 0);
  ok(Math.abs(sum - 3 * w.fan) < 0.01, '三家合计 = 3 份', `${sum} vs ${3 * w.fan}`);
}

console.log(`\n抢杠：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
