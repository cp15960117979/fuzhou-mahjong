// 抢金测试（v5 口径）：
//   抢金 = 开局庄家先打掉一张多余的牌之后，闲家把**开局翻出的那张公示金**拿进手牌胡。
//   - 抢的不是庄家打出的那张！庄家打 5 万、七条都行，抢的永远是公示金
//   - 庄家必须真的打过一手（天胡则没有这一手，抢金窗口不打开）
//   - 公示金加进 16 张手牌要真的能成 17 张牌型，才能抢
//   - 2 金 + 公示金 = 3 金时，允许拆开当赖子，不算三金倒
//   - 自摸摸到金不算抢金
const { Room } = require('../src/game.js');
const MJ = require('../src/mahjong.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

// 座位 0 是庄家（首打），座位 1 是闲家。
// 闲家 16 张：123/456/789 万 + 123/456 条 + 单张 21 筒，把公示金 26 当 21 筒成将 → 普通牌型。
//   这手只能靠"抢金"胡（不是大牌，点炮不成立）。
function setup({ opening = true, dealer = 0, tile = 15 } = {}) {
  const r = new Room('QJ');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.jinKanActive = false; r.joker = 26;
  r.dealer = dealer; r.turn = 0; r.opening = opening; r.pending = null; r.winners = null;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.flowerCount = 2; p.declaredTing = false;
    p.jinKan = false; p.lastDrawn = -1; p.eatPongCount = 0; p.providers = [];
  });
  // 庄家 17 张（16 + 刚摸的一张），首打 tile
  r.players[0].hand = [tile, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 24, 25];
  r.players[1].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21];
  r.players[2].hand = [9, 10, 11, 18, 19, 20, 21, 22, 23, 12, 13, 14, 15, 16, 24, 25];
  r.players[3].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const res = r.discard(0, tile);
  if (!res.ok) throw new Error('discard failed: ' + res.msg);
  return r;
}

// 自由摆牌：hands[0] 是庄家（17 张，含要打出的 tile），其余三家各 16 张
function setupTable(hands, { joker = 26, dealer = 0, tile = 15 } = {}) {
  const r = new Room('QJT');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.jinKanActive = false; r.joker = joker;
  r.dealer = dealer; r.turn = dealer; r.opening = true; r.pending = null; r.winners = null;
  r.players.forEach((p, i) => {
    p.hand = hands[i].slice(); p.melds = []; p.discards = []; p.flowerCount = 2;
    p.declaredTing = false; p.jinKan = false; p.lastDrawn = i === dealer ? hands[i][0] : -1;
    p.eatPongCount = 0; p.providers = [];
  });
  const res = r.discard(dealer, tile);
  if (!res.ok) throw new Error('discard failed: ' + res.msg);
  return r;
}

// 1) 核心场景（用户截图那种）：庄家首打**七条**，闲家拿公示金能胡 → 必须能抢金
{
  const r = setup({ tile: 15 }); // 15 = 七条，跟公示金（九筒）完全无关
  ok(r.pending && r.pending.qiangjin === true, '庄家首打任意牌 → 都打开抢金窗口', r.pending && r.pending.qiangjin);
  ok(!!r.pending && r.pending.seats.includes(1), '闲家进入响应列表', JSON.stringify(r.pending && r.pending.seats));
  ok(r.getState(1).actions.includes('hu'), '闲家有"胡"按钮（拿公示金抢金）', JSON.stringify(r.getState(1).actions));
  const huInfo = r.getState(1).players.find((p) => p.seat === 1).huInfo;
  ok(huInfo && huInfo.kind === 'qiangjin', '按钮标记为抢金', JSON.stringify(huInfo));
  ok(huInfo && huInfo.qiangjinTile === 26, '按钮带上"抢的是哪张金"', huInfo && huInfo.qiangjinTile);
  ok(!(r.pending.xiaoHu || []).includes(1), '抢金玩家不被误标成"小胡只能自摸"', r.pending.xiaoHu);

  const res = r.claim(1, 'hu');
  ok(res && res.ok, '点下去真的能胡（不能被"小胡只能自摸"拦掉）', JSON.stringify(res));
  if (r.pending) {
    for (const s of r.pending.seats.slice()) {
      if (s !== 1 && !r.pending.responded.has(s)) r.claim(s, 'pass');
    }
  }
  const w = r.winners;
  ok(w && w.winner === 1 && !w.draw, '座位 1 抢金成功', JSON.stringify(w && w.winner));
  ok(w && w.winTile === 26, '胡的是公示金（九筒），不是庄家打出的七条', w && w.winTile);
  ok(w && w.qiangjin === true, '标记为抢金', w && w.qiangjin);
  ok(w && (w.detail || []).some((d) => d.includes('抢金')), '结算里有抢金奖励', JSON.stringify(w && w.detail));
  ok(w && w.payers.length === 3, '三家分摊', JSON.stringify(w && w.payers));
}

// 2) 庄家首打的就是金 → 同样按"拿公示金"算，不是抢弃牌
{
  const r = setup({ tile: 26 });
  ok(r.pending && r.pending.qiangjin === true, '庄家打金也开抢金窗口', r.pending && r.pending.qiangjin);
  const acts = (r.pending.acts.find((a) => a.seat === 1) || {}).acts || [];
  ok(acts.includes('hu'), '闲家能抢金', JSON.stringify(acts));
  r.claim(1, 'hu');
  if (r.pending) for (const s of r.pending.seats.slice()) if (s !== 1 && !r.pending.responded.has(s)) r.claim(s, 'pass');
  const w = r.winners;
  ok(w && w.winTile === 26 && w.qiangjin === true, '胡的仍是公示金', w && `${w.winTile}/${w.qiangjin}`);
}

// 3) 公示金也补不成牌 → 没有胡按钮
{
  const r = setup({ tile: 15 });
  const p1 = r.getPlayer(1);
  p1.hand = [0, 3, 6, 9, 12, 18, 21, 24, 1, 4, 7, 10, 13, 19, 22, 25]; // 全散牌
  ok(!r.canQiangjin(p1), '拿公示金也成不了牌 → 无抢金资格', r.canQiangjin(p1));
  const acts = r.availableClaims(p1, 15, 0, true);
  ok(!acts.includes('hu'), '没有"胡"按钮', JSON.stringify(acts));
}

// 4) 没开抢金窗口（非庄家首打）→ 打什么都不能抢
{
  const r = setup({ opening: false });
  ok(!r.pending || !r.pending.qiangjin, '窗口关闭：不是抢金', r.pending && r.pending.qiangjin);
  const p1 = r.getPlayer(1);
  p1.hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21];
  // 资格函数本身只看"公示金能否成牌"，但窗口不由它决定
  ok(r.canQiangjin(p1) === true, '（对照）这手牌本身具备抢金资格', r.canQiangjin(p1));
  const acts = r.availableClaims(p1, 15, 0, false);
  ok(!acts.includes('hu'), '窗口外不给胡按钮', JSON.stringify(acts));
}

// 5) 抢金窗口只限庄家首打这一手：庄家打完后 opening 立即关闭
{
  const r = setup({ tile: 15 });
  ok(r.opening === false, '庄家首打后窗口立即关闭', r.opening);
}

// 6) 手里 2 金 + 抢进第 3 金：三张金可以拆开当赖子分到各面子/将里
{
  const hand = [26, 26, 0, 1, 3, 4, 9, 10, 18, 19, 20, 21, 22, 23, 24, 24];
  const win = MJ.checkWinEx(hand.concat([26]), [], 26, { qiangjin: true });
  ok(win.win === true, '2 金 + 公示金 → 3 金全当赖子，牌型成立', win);
  ok(win.type === 'standard', '抢金时按标准牌型算，不是三金倒', win.type);
  ok(win.feats.sanjindao === false, '抢金进来的第 3 张金不算三金倒', win.feats);
  ok(!MJ.labelsOf(win).includes('三金倒'), '牌型标签里没有三金倒', MJ.labelsOf(win));

  const self = MJ.checkWinEx(hand.concat([26]), [], 26, {});
  ok(self.feats.sanjindao === true, '（对照）自己摸到第 3 张金仍判三金倒', self.feats);

  const r = setup({ tile: 15 });
  const p1 = r.getPlayer(1);
  p1.hand = hand.slice(); p1.melds = []; p1.flowerCount = 2;
  const s = r.calcDaluan(win, { winner: p1, zimo: false, from: 0, qiangjin: true, winTile: 26 });
  ok(s.detail.some((d) => d.startsWith('抢金')), '结算有抢金奖励', s.detail);
  ok(!s.detail.some((d) => d.includes('三金倒')), '结算没有三金倒', s.detail);
  ok(s.detail.some((d) => d.includes('金（3）')), '抢进来的金也计入金数（2+1=3）', s.detail);
}

// 7) 抢金进第 3 张金也拆不出牌型 → 不能胡（三金倒不能靠抢金成立）
{
  const sevenPairs = [26, 26, 0, 0, 3, 3, 6, 6, 9, 9, 12, 12, 15, 15, 18, 18];
  const win = MJ.checkWinEx(sevenPairs.concat([26]), [], 26, { qiangjin: true });
  ok(win.win === false, '3 金拆不出 5 面子 + 将 → 抢金不成胡', win);
  const self = MJ.checkWinEx(sevenPairs.concat([26]), [], 26, {});
  ok(self.win === true && self.type === 'sanjindao', '（对照）自己摸到第 3 金仍是三金倒', self.type);

  const r = setup({ tile: 15 });
  const p1 = r.getPlayer(1);
  p1.hand = sevenPairs.slice(); p1.melds = [];
  ok(r.canQiangjin(p1) === false, '这手抢不了金', r.canQiangjin(p1));
}

// 8) 自己摸到金胡 → 不算抢金
{
  const r = setup({ tile: 15 });
  const p = r.getPlayer(0);
  p.melds = []; p.flowerCount = 2;
  p.hand = [26, 26, 0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4].sort((a, b) => a - b);
  p.lastDrawn = 26;
  r.turn = 0; r.pending = null; r.phase = 'playing'; r.lastDiscard = null; r.opening = false;
  const res = r.selfHu(0);
  ok(res && res.ok, '摸金自摸能胡', res);
  const w = r.winners;
  ok(w && w.qiangjin === false, '摸金胡不算抢金', w && w.qiangjin);
  ok(!(w.detail || []).some((d) => d.startsWith('抢金')), '结算没有抢金 +8', w && w.detail);
  ok((w.detail || []).some((d) => d.startsWith('金雀')), '2 金做将按金雀算（+12）', w && w.detail);
}

// 9) 闲家（非庄）不能抢自己是庄家时的金；庄家自己没有抢金资格
{
  const r = setup({ tile: 15, dealer: 1 });
  ok(r.canQiangjin(r.getPlayer(1)) === false, '庄家自己不能抢金', r.canQiangjin(r.getPlayer(1)));
}

// 10) 抢金与点炮并存时，按抢金算（金是万能牌，抢金不会更小）
{
  const r = setup({ tile: 15 });
  const p1 = r.getPlayer(1);
  // 这手用公示金 26 能胡；同时 15 七条也能点炮（13,14 + 15 成顺）
  p1.hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21];
  ok(r.canQiangjin(p1) === true, '能用公示金胡', r.canQiangjin(p1));
  const acts = r.availableClaims(p1, 15, 0, true);
  ok(acts.includes('hu'), '只给一个"胡"按钮', JSON.stringify(acts));
  r.claim(1, 'hu');
  if (r.pending) for (const s of r.pending.seats.slice()) if (s !== 1 && !r.pending.responded.has(s)) r.claim(s, 'pass');
  ok(r.winners && r.winners.qiangjin === true, '并存时优先按抢金结算', r.winners && r.winners.qiangjin);
}


// ---------- 抢金的叠加规则 ----------
// 抢金是最小的大牌（+8），可以和「起手就是大牌」的那些牌型叠加：
//   抢金对对胡 / 抢金清一色 / 抢金混一色 / 抢金金雀 / 抢金金龙；
//   但**永远不能叠加三金倒**（3 金只能拆开当赖子，或成刻算金龙）。
function scoreOf(hand, { joker = 26, flower = 2 } = {}) {
  const win = MJ.checkWinEx(hand.concat([joker]), [], joker, { qiangjin: true });
  const r = setup({ tile: 15 });
  const p1 = r.getPlayer(1);
  p1.hand = hand.slice(); p1.melds = []; p1.flowerCount = flower;
  const s2 = r.calcDaluan(win, { winner: p1, zimo: false, from: 0, qiangjin: true, winTile: joker });
  return { win, s: s2, detail: s2.detail, fan: s2.fan };
}

// 11) 抢金 + 金雀：手里 1 金 + 5 组顺子，抢进公示金 → 双金作将
{
  // 金 = 九筒(26)；手里 26 + 123/456/789 万 + 123/456 条 = 16 张
  const hand = [26, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const { win, detail, fan } = scoreOf(hand);
  ok(win.win === true && win.type === 'standard', '抢金 + 金雀：牌型成立', win);
  ok(win.feats.jinque === true, '双金都作将 → 判金雀', win.feats);
  ok(detail.some((d) => d.startsWith('金雀')), '结算叠加「金雀（12）」', detail);
  ok(detail.some((d) => d.startsWith('抢金')), '结算有「抢金（8）」', detail);
  ok(fan === 22, `片数 = 2（基础）+ 8 + 12 = 22，实=${fan}`, detail);
}

// 12) 抢金 + 金龙：手里 2 金 + 4 面子 + 将，抢进第 3 金成刻
{
  // 26,26 + 123/456/789 万 + 123 条 + 99 条 = 16 张
  const hand = [26, 26, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 17, 17];
  const { win, detail, fan } = scoreOf(hand);
  ok(win.win === true, '抢金 + 金龙：牌型成立', win);
  ok(win.feats.jinlong === true, '3 金成刻 → 判金龙', win.feats);
  ok(win.feats.sanjindao === false, '金龙优先，不标三金倒', win.feats);
  ok(detail.some((d) => d.startsWith('金龙')), '结算叠加「金龙（24）」', detail);
  ok(!detail.some((d) => d.includes('三金倒')), '结算没有三金倒', detail);
  ok(fan === 34, `片数 = 2（基础）+ 8 + 24 = 34，实=${fan}（金 3 张计入基础）`, detail);
}

// 13) 抢金 + 有金对对胡 + 金雀：1 金 + 5 组刻子
{
  const hand = [26, 0, 0, 0, 3, 3, 3, 6, 6, 6, 9, 9, 9, 12, 12, 12];
  const { win, detail, fan } = scoreOf(hand);
  ok(win.win === true && win.feats.pengpeng === true, '抢金 + 对对胡成立', win.feats);
  ok(win.feats.youjinDuizi === true, '有金对对胡', win.feats);
  ok(detail.some((d) => d.startsWith('有金对对胡')), '结算叠加「有金对对胡（8）」', detail);
  ok(detail.some((d) => d.startsWith('金雀')), '同时叠加「金雀（12）」', detail);
  ok(fan === 30, `片数 = 2（基础）+ 8 + 8 + 12 = 30，实=${fan}`, detail);
}

// 14) 抢金 + 混一色 + 金雀：数牌全一门、金是另一门
{
  // 金 26（筒），数牌全是万（012/123/234/345/456 万五组顺子）→ 混一色
  const hand = [26, 0, 1, 2, 1, 2, 3, 2, 3, 4, 3, 4, 5, 4, 5, 6];
  const { win, detail, fan } = scoreOf(hand);
  ok(win.feats.hunyise === true, '金在另一门 → 混一色', win.feats);
  ok(detail.some((d) => d.startsWith('混一色')), '结算叠加「混一色（24）」', detail);
  ok(fan === 46, `片数 = 2 + 8 + 12 + 24 = 46，实=${fan}`, detail);
}

// 15) 抢金 + 纯清一色 + 金雀：金与数牌同门
{
  // 金 26（九筒），数牌全是筒，五组顺子（不是刻子，避免叠上对对胡）
  const hand = [26, 18, 19, 20, 19, 20, 21, 20, 21, 22, 21, 22, 23, 22, 23, 24];
  const { win, detail, fan } = scoreOf(hand);
  ok(win.feats.qingyise === true, '金同门 → 纯清一色', win.feats);
  ok(detail.some((d) => d.startsWith('纯清一色')), '结算叠加「纯清一色（48）」', detail);
  ok(fan === 70, `片数 = 2 + 8 + 12 + 48 = 70，实=${fan}`, detail);
}

// 16) 抢金 与 三金倒 永不叠加：3 金散牌拆成普通型 / 拆不开都不能胡
{
  const hand = [26, 26, 0, 1, 3, 4, 9, 10, 18, 19, 20, 21, 22, 23, 24, 24];
  const { win, detail } = scoreOf(hand);
  ok(win.feats.sanjindao === false, '3 金拆开当赖子 → 不标三金倒', win.feats);
  ok(!detail.some((d) => d.includes('三金倒')), '结算绝不出现三金倒', detail);
  ok(!MJ.labelsOf(win).includes('三金倒'), '标签也不出现三金倒', MJ.labelsOf(win));
}

// 17) 抢金 + 金雀时的按钮标签：抢金时保留"金雀"，普通点炮仍然不标
{
  const r = setup({ tile: 15 });
  const p1 = r.getPlayer(1);
  p1.hand = [26, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
  const acts = r.availableClaims(p1, 15, 0, true);
  ok(acts.includes('hu'), '有胡按钮', JSON.stringify(acts));
  const huInfo = r.getState(1).players.find((x) => x.seat === 1).huInfo;
  ok(huInfo && huInfo.kind === 'qiangjin', '按钮是抢金', huInfo);
  ok(huInfo && huInfo.labels.includes('金雀'), '抢金按钮上带「金雀」', huInfo && huInfo.labels);
  ok(huInfo && !huInfo.labels.includes('三金倒'), '不带三金倒', huInfo && huInfo.labels);
}


// 18) 手里 2 金但只有 1 张能作将（另一张得去补面子）→ 只是普通抢金，不加金雀
{
  // 抢前 1 金 + 15 张数牌：123/456/789 万 + 123 条 + 45 条 + 孤张 9 条
  // 抢进公示金后，一张金补 6 条成顺子、另一张作将 → 成牌，但不是"双金作将"
  const hand = [26, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 14, 17];
  const { win, detail, fan } = scoreOf(hand);
  ok(win.win === true && win.type === 'standard', '能成牌', win);
  ok(win.feats.jinque === false, '只有一金作将 → 不算金雀', win.feats);
  ok(!MJ.labelsOf(win).includes('金雀'), '标签里没有金雀', MJ.labelsOf(win));
  ok(detail.some((d) => d.startsWith('抢金')), '仍然是抢金', detail);
  ok(!detail.some((d) => d.startsWith('金雀')), '结算不出现金雀', detail);
  ok(fan === 10, `片数 = 2（基础）+ 8（抢金）= 10，实=${fan}`, detail);
}

// 19) 庄家打完首张后同样能抢金（手牌也剩 16 张），只是优先级最低
{
  const r = setupTable([
    [35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21], // 庄：17 张，打 35
    [0, 0, 1, 1, 3, 3, 9, 9, 18, 18, 21, 21, 36, 37, 38, 39],
    [2, 2, 4, 4, 5, 5, 10, 10, 19, 19, 22, 22, 40, 41, 42, 43],
    [6, 6, 7, 7, 8, 8, 11, 11, 20, 20, 23, 23, 44, 45, 46, 47],
  ], { tile: 35 });
  ok(r.canQiangjin(r.getPlayer(0)) === true, '庄家打完首张 → 有抢金资格', r.getPlayer(0).hand.length);
  ok(r.pending && r.pending.seats.includes(0), '庄家自己也在响应列表里', JSON.stringify(r.pending && r.pending.seats));
  const acts0 = (r.pending.acts.find((a) => a.seat === 0) || {}).acts || [];
  ok(acts0.includes('hu') && acts0.length === 1, '庄家只有「胡」一个动作（不能吃碰自己的牌）', JSON.stringify(acts0));
  const hi = r.getState(0).players.find((p) => p.seat === 0).huInfo;
  ok(hi && hi.kind === 'qiangjin', '庄家按钮也标成抢金', hi);
  r.claim(0, 'hu');
  if (r.pending) for (const s of r.pending.seats.slice()) if (s !== 0 && !r.pending.responded.has(s)) r.claim(s, 'pass');
  const w = r.winners;
  ok(w && w.winner === 0 && w.qiangjin === true, '庄家抢金成功', w && `${w.winner}/${w.qiangjin}`);
  ok(w && w.winTile === 26, '庄家胡的也是公示金', w && w.winTile);
}

// 20) 庄家没打牌（开局 17 张）时不能抢
{
  const r = new Room('QJ3');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.jinKanActive = false; r.joker = 26; r.dealer = 0;
  r.players.forEach((p) => { p.melds = []; p.discards = []; p.jinKan = false; p.flowerCount = 2; });
  r.getPlayer(0).hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21, 35];
  ok(r.canQiangjin(r.getPlayer(0)) === false, '庄家 17 张未出牌 → 不能抢金', r.getPlayer(0).hand.length);
}

// 21) 多家同时抢金：叠加的大牌大的优先（不是单纯按座位）
{
  const r = setupTable([
    [35, 9, 10, 11, 18, 19, 20, 21, 22, 23, 12, 13, 14, 15, 16, 24, 25], // 庄：不能抢
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 4],                  // 闲1：混一色（金是筒）
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21],            // 闲2：普通抢金
    [2, 2, 4, 4, 5, 5, 10, 10, 19, 19, 22, 22, 40, 41, 42, 43],        // 闲3：不能抢
  ], { tile: 35 });
  ok(r.canQiangjin(r.getPlayer(1)) && r.canQiangjin(r.getPlayer(2)), '两家都能抢', '');
  ok(r.qiangjinValue(r.getPlayer(1)) > r.qiangjinValue(r.getPlayer(2)), '混一色那手奖励更大',
    [r.qiangjinValue(r.getPlayer(1)), r.qiangjinValue(r.getPlayer(2))]);
  r.claim(1, 'hu'); r.claim(2, 'hu');
  for (const s of r.pending.seats.slice()) if (!r.pending.responded.has(s)) r.claim(s, 'pass');
  ok(r.winners && r.winners.winner === 1, '奖励大的闲1 抢到', r.winners && r.winners.winner);
  ok(r.winners && r.winners.feats && r.winners.feats.hunyise === true, '结算确实是混一色抢金',
    r.winners && r.winners.feats);
}

// 22) 同样都是普通抢金 → 按逆时针：庄家下家先，庄家最后
{
  const r = setupTable([
    [35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21],  // 庄：普通抢金牌型
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21],      // 闲1：普通
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 18, 19, 20, 21, 22, 23, 24],      // 闲2：普通
    [2, 2, 4, 4, 5, 5, 10, 10, 19, 19, 22, 22, 40, 41, 42, 43],   // 闲3：不能抢
  ], { tile: 35 });
  ok(r.canQiangjin(r.getPlayer(0)) && r.canQiangjin(r.getPlayer(1)), '庄家和闲1 都能抢', '');
  ok(r.qiangjinValue(r.getPlayer(0)) === r.qiangjinValue(r.getPlayer(1)), '两手奖励一样大',
    [r.qiangjinValue(r.getPlayer(0)), r.qiangjinValue(r.getPlayer(1))]);
  r.claim(0, 'hu'); r.claim(1, 'hu');
  for (const s of r.pending.seats.slice()) if (!r.pending.responded.has(s)) r.claim(s, 'pass');
  ok(r.winners && r.winners.winner === 1, '一样大时庄家下家先抢（庄家最后）', r.winners && r.winners.winner);
}

// 23) 庄家叠加的大牌更大 → 即使优先级最后，也归庄家
{
  const r = setupTable([
    [35, 0, 1, 2, 3, 4, 5, 6, 7, 8, 0, 1, 2, 3, 4, 5, 4],      // 庄：清一色
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21],      // 闲1：普通
    [2, 2, 4, 4, 5, 5, 10, 10, 19, 19, 22, 22, 40, 41, 42, 43],
    [6, 6, 7, 7, 8, 8, 11, 11, 20, 20, 23, 23, 44, 45, 46, 47],
  ], { tile: 35 });
  ok(r.canQiangjin(r.getPlayer(0)) && r.canQiangjin(r.getPlayer(1)), '两家都能抢', '');
  r.claim(1, 'hu'); r.claim(0, 'hu');
  for (const s of r.pending.seats.slice()) if (!r.pending.responded.has(s)) r.claim(s, 'pass');
  ok(r.winners && r.winners.winner === 0, '庄家混一色更大 → 庄家抢到', r.winners && r.winners.winner);
}

console.log(`\n抢金：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
