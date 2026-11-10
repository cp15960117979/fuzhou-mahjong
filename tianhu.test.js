// 天胡：庄家开金后第一手（还没人打过牌）就成牌 → +8 片，且优先于别人的三金倒
const { Room } = require('../src/game.js');
const MJ = require('../src/mahjong.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

function room(joker = 26) {
  const r = new Room('TH');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = true; r.turn = 0; r.dealer = 0; r.joker = joker;
  r.pending = null; r.winners = null; r.lianZhuang = 0;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.flowerCount = 0;
    p.jinKan = false; p.lastDrawn = -1; p.declaredTing = false; p.score = 0;
  });
  return r;
}

// 一手普通成牌（花 2，无大牌）：012 345 678 万 + 91011 条 + 121314 条 + 99 将
const NORMAL = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 15];

// 1) 庄家开局 17 张成牌 → 天胡
{
  const r = room();
  const d = r.getPlayer(0);
  d.hand = NORMAL.slice();
  d.flowerCount = 2;
  d.lastDrawn = 15;
  r.selfCanHu = true;
  ok(r.isTianHu(0) === true, '庄家第一手 17 张成牌 = 天胡');
  const st = r.getState(0);
  ok((st.players[0].huInfo || {}).labels.includes('天胡'), '胡按钮写「天胡」', st.players[0].huInfo);
  const res = r.selfHu(0);
  ok(res && res.ok, '天胡能胡', res);
  const w = r.winners;
  ok(w.tianhu === true, '结算标记 tianhu', w.tianhu);
  ok((w.labels || []).includes('天胡'), '结算标题带天胡', w.labels);
  ok((w.detail || []).some((x) => x.startsWith('天胡（8）')), '天胡 +8 片', w.detail);
  // 花2 → 2×2=4 → 1 片；天胡 8 → 9 片
  ok(w.fan === 9, `天胡 2花 = 9 片, 实=${w.fan} (${w.summary})`, w.summary);
}

// 2) 同样的牌在闲家手里 → 不是天胡，也没有 +8
{
  const r = room();
  const p = r.getPlayer(1);
  p.hand = NORMAL.slice();
  p.flowerCount = 2;
  p.lastDrawn = 15;
  r.turn = 1;
  ok(r.isTianHu(1) === false, '闲家成牌不算天胡');
  const res = r.selfHu(1);
  ok(res && res.ok, '闲家能正常自摸', res);
  ok(!(r.winners.detail || []).some((x) => x.startsWith('天胡')), '闲家没有天胡奖励', r.winners.detail);
  ok(r.winners.fan === 2, `闲家 2花普通自摸 = 2 片, 实=${r.winners.fan}`, r.winners.summary);
}

// 3) 只要有人打过牌，就不再是天胡
{
  const r = room();
  const d = r.getPlayer(0);
  d.hand = NORMAL.slice();
  d.flowerCount = 2;
  d.lastDrawn = 15;
  r.getPlayer(1).discards.push(20);
  ok(r.isTianHu(0) === false, '场上已经有人打过牌 → 不算天胡');
}

// 4) 天胡不叠加抢金：第一手摸到的正好是金，也只算天胡 +8
{
  const r = room(26);
  const d = r.getPlayer(0);
  d.hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 26, 26];
  d.flowerCount = 2;
  d.lastDrawn = 26; // 摸到金
  const res = r.selfHu(0);
  ok(res && res.ok, '摸到金的第一手也能胡', res);
  const w = r.winners;
  ok(w.tianhu === true, '标记天胡', w.tianhu);
  ok((w.detail || []).some((x) => x.startsWith('天胡')), '有天胡奖励', w.detail);
  ok(!(w.detail || []).some((x) => x.startsWith('抢金')), '天胡不再重复算抢金', w.detail);
}

// 5) 天胡优先：别人手里 3 金（三金倒），但庄家第一手就胡 → 庄家先胡
{
  const r = room();
  const d = r.getPlayer(0);
  const other = r.getPlayer(2);
  d.hand = NORMAL.slice();
  d.flowerCount = 2;
  d.lastDrawn = 15;
  other.hand = [26, 26, 26, 0, 2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22]; // 3 金散牌
  ok(r.checkWinOf(other).type === 'sanjindao', '（前提）闲家手里 3 金能三金倒');
  ok(!(r.getState(2).actions || []).includes('hu'), '还没轮到闲家 → 三金倒抢不到庄家前面');
  const res = r.selfHu(0);
  ok(res && res.ok, '庄家天胡成功', res);
  ok(r.winners.winner === 0 && r.winners.tianhu === true, '胡的是庄家、且算天胡', r.winners.winner);
}

// 6) 三金倒不算天胡：3 金散牌第一手倒 → 只有三金倒，没有天胡
{
  const r = room();
  const d = r.getPlayer(0);
  d.hand = [26, 26, 26, 0, 2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22, 24];
  d.flowerCount = 3;
  d.lastDrawn = 26;
  ok(r.isTianHu(0) === true, '（前提）确实是庄家第一手');
  ok(r.isTianHuWin(d) === false, '但 3 金散牌只是三金倒，不算天胡');
  const res = r.selfHu(0);
  ok(res && res.ok, '庄家第一手 3 金能倒', res);
  const w = r.winners;
  ok(w.tianhu === false, '结算没有天胡标记', w.tianhu);
  ok(!(w.labels || []).includes('天胡'), '标题不写天胡', w.labels);
  ok(!(w.detail || []).some((x) => x.startsWith('天胡')), '明细没有天胡 +8', w.detail);
  ok((w.detail || []).some((x) => x.startsWith('三金倒')), '只有三金倒 +10', w.detail);
}

// 7) 3 金成刻子 + 其余成牌 → 天胡金龙（天胡 8 + 金龙 24）
{
  const r = room(26);
  const d = r.getPlayer(0);
  // 3 金 + 123 456 123 456 筒 + 77 筒
  d.hand = [26, 26, 26, 18, 19, 20, 21, 22, 23, 18, 19, 20, 21, 22, 23, 24, 24];
  d.flowerCount = 3;
  d.lastDrawn = 24;
  ok(r.isTianHuWin(d) === true, '3 金成刻子 + 其余成牌 = 天胡金龙');
  const res = r.selfHu(0);
  ok(res && res.ok, '天胡金龙能胡', res);
  const w = r.winners;
  ok(w.tianhu === true, '标记天胡', w.tianhu);
  ok((w.labels || []).includes('天胡') && (w.labels || []).includes('金龙'), '标题写天胡 + 金龙', w.labels);
  ok((w.detail || []).some((x) => x.startsWith('天胡')), '有天胡 +8', w.detail);
  ok((w.detail || []).some((x) => x.startsWith('金龙')), '有金龙 +24', w.detail);
}

// 8) 机器人拿到天胡不会"忍一手"
{
  const BOT = require('../src/bot.js');
  const r = room();
  const d = r.getPlayer(0);
  d.isBot = true;
  d.hand = NORMAL.slice();
  d.flowerCount = 2;
  d.lastDrawn = 15;
  r.selfCanHu = true;
  BOT.botDecide(r, 0);
  ok(r.winners && r.winners.winner === 0, '机器人遇天胡直接胡', r.winners && r.winners.summary);
}

console.log(`\n天胡：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
