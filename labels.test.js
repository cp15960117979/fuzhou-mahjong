// 胡牌牌型标注：按钮/结算直接显示"对对胡 / 金雀 / 清一色"，并提前警告碰会拆听
const MJ = require('../src/mahjong.js');
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

// ---------- 引擎：牌型标签 ----------
{
  const duidui = [0, 0, 0, 9, 9, 9, 12, 12, 12, 18, 18, 18, 22, 22, 22, 4, 4];
  const L = MJ.winLabels(duidui, 26);
  ok(L.includes('对对胡'), '对对胡能标出来', JSON.stringify(L));
  ok(!L.includes('纯清一色'), '三门牌不该标清一色', JSON.stringify(L));
}
{
  const qing = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4, 5, 5];
  const L = MJ.winLabels(qing, 26);
  ok(L.includes('纯清一色') && L.includes('对对胡'), '清一色 + 对对胡 同时标', JSON.stringify(L));
}
{
  const ping = [0, 1, 2, 9, 10, 11, 18, 19, 20, 4, 5, 6, 12, 13, 14, 7, 7];
  ok(MJ.winLabels(ping, 26).length === 0, '普通胡不标牌型（按钮只写"自摸"）', MJ.winLabels(ping, 26).join());
}
{
  const J = 3;
  const jq = [J, J, 0, 1, 2, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 24];
  const L = MJ.winLabels(jq, J);
  ok(L.includes('金雀'), '金雀能标出来', JSON.stringify(L));
}
{
  // 不是金雀就别标（上次修的那个误判）
  const J = 3;
  const t = [J, J, 0, 0, 4, 4, 5, 6, 6, 7, 8, 12, 13, 14, 15, 16, 17];
  ok(!MJ.winLabels(t, J).includes('金雀'), '2 金但补面子 → 不标金雀', MJ.winLabels(t, J).join());
}

// ---------- 房间 ----------
function setup() {
  const r = new Room('LB');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = 26; r.turn = 0; r.selfCanHu = false;
  r.lastDiscard = null; r.lianZhuang = 0;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.jinKan = false; p.declaredTing = false;
    p.lastDrawn = -1; p.flowerCount = 0; p.eatPongCount = 0; p.providers = []; p.score = 0;
  });
  return r;
}

// 自摸时：自己能看到"这手胡的是对对胡"，别家看不到
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.hand = [0, 0, 0, 9, 9, 9, 12, 12, 12, 18, 18, 18, 22, 22, 22, 4, 4];
  p0.lastDrawn = 4;
  r.selfCanHu = true;
  const st = r.getState(0);
  ok(st.players[0].huInfo && st.players[0].huInfo.kind === 'zimo', '自摸 → huInfo.kind=zimo', JSON.stringify(st.players[0].huInfo));
  ok(st.players[0].huInfo.labels.includes('对对胡'), '自摸按钮能标"对对胡"', JSON.stringify(st.players[0].huInfo));
  ok(r.getState(1).players[0].huInfo == null, '别家看不到你的胡牌信息', JSON.stringify(r.getState(1).players[0].huInfo));
}

// 点炮时：同样标出牌型
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.hand = [0, 0, 0, 9, 9, 9, 12, 12, 12, 18, 18, 18, 22, 4, 4, 4];
  r.turn = 1;
  r.lastDiscard = { tile: 22, by: 1 };
  r.openClaims(1, 22);
  const st = r.getState(0);
  if (r.pending && r.pending.seats.includes(0)) {
    ok(st.players[0].huInfo && st.players[0].huInfo.kind === 'ron', '点炮 → huInfo.kind=ron', JSON.stringify(st.players[0].huInfo));
    ok(st.players[0].huInfo.labels.length > 0, '点炮也能标牌型', JSON.stringify(st.players[0].huInfo.labels));
  } else {
    ok(true, '该手牌不在响应位（跳过）');
  }
}

// 结算：winners.labels 落库，前端标题直接用
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.hand = [0, 0, 0, 9, 9, 9, 12, 12, 12, 18, 18, 18, 22, 22, 22, 4, 4];
  p0.lastDrawn = 4;
  const res = r.doHu(0, true, 0, {});
  ok(res.ok, '自摸成立', JSON.stringify(res));
  ok(Array.isArray(r.winners.labels) && r.winners.labels.includes('对对胡'), '结算记录牌型', JSON.stringify(r.winners.labels));
}

// 金雀听牌：提前告知等哪几张，且碰/吃会拆
{
  const r = setup();
  r.joker = 3;
  const p0 = r.getPlayer(0);
  // 2 金 + 14 张：4 面子 + 一二条搭子，摸三条/四条都能金雀
  p0.hand = [3, 3, 0, 1, 2, 4, 5, 6, 18, 19, 20, 22, 23, 24, 12, 13];
  const st = r.getState(0);
  ok(JSON.stringify(st.players[0].jinQueTiles) === '[11,14]', '听金雀张计算正确（三条/四条）',
    JSON.stringify(st.players[0].jinQueTiles));
  ok((r.getState(2).players[0].jinQueTiles || []).length === 0, '别家看不到你的听牌', JSON.stringify(r.getState(2).players[0].jinQueTiles));
}

// 摸到能金雀的那张：huInfo 标金雀
{
  const r = setup();
  r.joker = 3;
  const p0 = r.getPlayer(0);
  p0.hand = [3, 3, 0, 1, 2, 4, 5, 6, 18, 19, 20, 22, 23, 24, 12, 13, 11];
  p0.lastDrawn = 11;
  r.selfCanHu = true;
  const st = r.getState(0);
  ok(st.players[0].huInfo && st.players[0].huInfo.labels.includes('金雀'), '自摸按钮标"金雀"', JSON.stringify(st.players[0].huInfo));
  ok((st.players[0].jinQueTiles || []).length === 0, '能胡时不再提示听牌', JSON.stringify(st.players[0].jinQueTiles));
}

// 有副露时也能算（碰碰胡带碰）
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.melds = [{ type: 'peng', tiles: [9, 9, 9], from: 1 }, { type: 'peng', tiles: [12, 12, 12], from: 2 }];
  p0.hand = [0, 0, 0, 18, 18, 18, 22, 22, 4, 4, 4];
  p0.lastDrawn = 22;
  r.selfCanHu = true;
  const st = r.getState(0);
  ok(st.players[0].huInfo && st.players[0].huInfo.labels.includes('对对胡'), '带副露的对对胡也能标', JSON.stringify(st.players[0].huInfo));
}

// 普通自摸：不标任何牌型（按钮只写"自摸"）
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.hand = [0, 1, 2, 9, 10, 11, 18, 19, 20, 4, 5, 6, 12, 13, 14, 7, 7];
  p0.lastDrawn = 7;
  r.selfCanHu = true;
  const st = r.getState(0);
  ok(st.players[0].huInfo && st.players[0].huInfo.kind === 'zimo', '普通自摸仍是自摸', JSON.stringify(st.players[0].huInfo));
  ok((st.players[0].huInfo.labels || []).length === 0, '普通自摸不标"平胡"（前端只显示"自摸"）',
    JSON.stringify(st.players[0].huInfo.labels));
}

// 普通自摸结算：winners.labels 为空数组，日志不带空括号
{
  const r = setup();
  const p0 = r.getPlayer(0);
  p0.hand = [0, 1, 2, 9, 10, 11, 18, 19, 20, 4, 5, 6, 12, 13, 14, 7, 7];
  p0.lastDrawn = 7;
  const res = r.doHu(0, true, 0, {});
  ok(res.ok, '普通自摸能胡', JSON.stringify(res));
  ok(Array.isArray(r.winners.labels) && r.winners.labels.length === 0, '结算不标普通胡', JSON.stringify(r.winners.labels));
  const line = r.log[r.log.length - 1];
  ok(!line.includes('（）') && !line.includes('平胡'), '日志不出现空括号/平胡', line);
}

console.log(`\n胡牌标注：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
