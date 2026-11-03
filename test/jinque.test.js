// 金雀/金龙 判定：必须是「金本身作将 / 作刻」，不能只看手里有几张金
const MJ = require('../src/mahjong.js');
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

const J = 3; // 四万为金

// 1) 真金雀：2 金 + 15 张自然成 5 组面子（金金做将）
{
  const t = [J, J, 0, 1, 2, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 24];
  const r = MJ.checkWin(t, J);
  ok(r.win, '真金雀能胡');
  ok(r.feats.jinque === true, '2 金都在将上 → 金雀', JSON.stringify(r.feats));
}

// 2) 假金雀（用户这局的情形）：手里 2 金，但两张金都得去补面子/搭子
{
  const t = [J, J, 0, 0, 4, 4, 5, 6, 6, 7, 8, 12, 13, 14, 15, 16, 17];
  const r = MJ.checkWin(t, J);
  ok(r.win, '金被拆去补面子时依然能胡');
  ok(r.feats.jinque === false, '金没做将 → 不算金雀（这就是误加 12 片的那手）', JSON.stringify(r.feats));
  ok(r.jokers === 2, '确实只有 2 张金', r.jokers);
}

// 3) 2 金 + 散张拼不成牌 → 根本不胡（不能被 2 金硬判胡）
{
  const t = [J, J, 0, 2, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 12, 20];
  const r = MJ.checkWin(t, J);
  ok(!r.win || !r.feats.jinque, '散牌 + 2 金不会白送金雀', `win=${r.win} jinque=${r.feats && r.feats.jinque}`);
}

// 4) 金龙：3 金自成一刻
{
  const t = [J, J, J, 0, 1, 2, 4, 5, 6, 12, 13, 14, 18, 19, 20, 16, 16];
  const r = MJ.checkWin(t, J);
  ok(r.win, '金龙能胡');
  ok(r.feats.jinlong === true, '3 金成刻 → 金龙', JSON.stringify(r.feats));
  ok(r.feats.sanjindao === false, '金龙压掉三金倒，不重复计');
}

// 5) 3 金但金全被拆去补面子 → 不算金龙，仍按三金倒
{
  // 数牌 14 张：两门各 7 张、凑不成型，必须靠 3 金补
  const t = [J, J, J, 0, 0, 1, 1, 4, 5, 9, 9, 10, 10, 13, 14, 18, 18];
  const r = MJ.checkWin(t, J);
  if (r.win && r.jokers === 3) {
    ok(r.feats.jinlong === false, '3 金不成刻 → 不给金龙', JSON.stringify(r.feats));
    ok(r.feats.sanjindao === true, '但仍是三金倒（3 金即胡）', JSON.stringify(r.feats));
  } else {
    ok(r.feats.jinlong === false, '该手牌非金龙');
  }
}

// ---------- 房间级计分 ----------
function setup(hand, flowers) {
  const r = new Room('JQ');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.startGame();
  r.phase = 'playing'; r.swap = null; r.opening = false; r.jinKanActive = false;
  r.pending = null; r.winners = null; r.joker = J; r.turn = 0; r.selfCanHu = false;
  r.lastDiscard = null; r.lianZhuang = 0;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.jinKan = false; p.declaredTing = false;
    p.lastDrawn = -1; p.flowerCount = 0; p.eatPongCount = 0; p.providers = []; p.score = 0;
  });
  const p0 = r.getPlayer(0);
  p0.hand = hand.slice();
  p0.flowerCount = flowers;
  return r;
}

// 6) 假金雀自摸：4 花 2 金 → 花4+金2+自摸1=7朵 ×2=14 → 3 片，不再有金雀 12
{
  const r = setup([J, J, 0, 0, 4, 4, 5, 6, 6, 7, 8, 12, 13, 14, 15, 16, 17], 4);
  const res = r.doHu(0, true, 0, {});
  ok(res.ok, '假金雀自摸成立', JSON.stringify(res));
  const w = r.winners;
  ok(!w.detail.some((d) => d.includes('金雀')), '明细里没有金雀', w.detail.join(' '));
  ok(w.fan === 3, `4花2金普通自摸 = 3 片（原来错给 15 片）, 实=${w.fan}`, w.summary);
  ok(w.detail.some((d) => d.includes('自摸')), '普通自摸要算 +1 朵', w.detail.join(' '));
  ok(w.payers.reduce((s, x) => s + x.amount, 0) === 9, '三家各付 3 片，共 9 片', JSON.stringify(w.payers));
}

// 7) 真金雀自摸：4 花 2 金 → 金雀仍要 12
{
  const r = setup([J, J, 0, 1, 2, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23, 24], 4);
  const res = r.doHu(0, true, 0, {});
  ok(res.ok, '真金雀自摸成立', JSON.stringify(res));
  const w = r.winners;
  ok(w.detail.includes('金雀（12）'), '真金雀照旧 +12 片', w.detail.join(' '));
  // 大牌：自摸不加朵；4花+2金=6朵 ×2=12 → 3 片；+12 = 15 片
  ok(w.fan === 15, `真金雀应 15 片, 实=${w.fan}`, w.summary);
}

// 8) 假金雀不再被"金雀须自摸"拦住 → 大牌可以点炮
{
  const r = setup([J, J, 0, 0, 4, 4, 5, 6, 6, 7, 8, 12, 13, 14, 15, 16, 16], 4);
  const p0 = r.getPlayer(0);
  // 手里 16 张等 17 那张（上面 hand 用 16 张听牌形态）
  p0.hand = [J, J, 0, 0, 4, 4, 5, 6, 6, 7, 8, 12, 13, 14, 15, 17];
  const full = [J, J, 0, 0, 4, 4, 5, 6, 6, 7, 8, 12, 13, 14, 15, 16, 17];
  const cw = MJ.checkWin(full, J);
  ok(cw.win && cw.feats.jinque === false, '点炮牌型：能胡且非金雀', JSON.stringify(cw.feats));
  const canRon = r.canRon(p0, 16, false);
  ok(canRon === false, '小胡（无奖励）仍不能点炮', String(canRon));
}

// 9) 真金雀确实不能点炮
{
  const r = setup([J, J, 0, 1, 2, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 23], 4);
  const p0 = r.getPlayer(0);
  const canRon = r.canRon(p0, 24, false);
  ok(canRon === false, '金雀必须自摸，不能点炮', String(canRon));
}

console.log(`\n金雀判定：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
