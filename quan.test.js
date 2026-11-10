// 圈 / 将 / 换庄方向 专项：闲家胡 → 逆时针下家坐庄；四圈一将，四圈打完结算重开
const assert = require('assert');
const { Room } = require('../src/game.js');

let pass = 0, fail = 0;
function ok(cond, msg, extra) {
  if (cond) { pass++; } else { fail++; console.log('  ✗', msg, extra === undefined ? '' : extra); }
}

function newRoom() {
  const r = new Room('Q');
  for (let i = 0; i < 4; i++) r.addPlayer({ send() {}, readyState: 1 }, 'P' + i);
  return r;
}
// 让 startGame 跑完发牌/换牌骰子即可，不关心牌面
function nextRound(r, lastResult, preset) {
  Object.assign(r, preset || {});
  r.lastResult = lastResult;
  r.startGame();
  if (r._swapTimer) { clearTimeout(r._swapTimer); r._swapTimer = null; }
}

// 1) 闲家胡 → 庄家下庄，逆时针轮到下家（不是胡牌的人坐庄）
{
  const r = newRoom();
  r.roundNo = 5; r.dealer = 1; r.lianZhuang = 3;
  r.quanNo = 2; r.quanDealerCount = 2;
  nextRound(r, { draw: false, winnerSeat: 3 });
  ok(r.dealer === 2, '庄 1 被闲家 3 胡 → 应轮到下家 2 坐庄（不是胡牌的 3）', r.dealer);
  ok(r.lianZhuang === 0, '换庄后连庄清零', r.lianZhuang);
  ok(r.quanDealerCount === 3, '本圈已坐庄数 +1', r.quanDealerCount);
}

// 2) 庄家自摸 → 连庄，圈不推进
{
  const r = newRoom();
  r.roundNo = 6; r.dealer = 2; r.lianZhuang = 0;
  r.quanNo = 2; r.quanDealerCount = 2;
  nextRound(r, { draw: false, winnerSeat: 2 });
  ok(r.dealer === 2, '庄家自摸应连庄', r.dealer);
  ok(r.lianZhuang === 1, '连庄数 +1', r.lianZhuang);
  ok(r.quanNo === 2 && r.quanDealerCount === 2, '连庄不推进圈', `${r.quanNo}/${r.quanDealerCount}`);
}

// 3) 流局（臭庄）→ 连庄
{
  const r = newRoom();
  r.roundNo = 7; r.dealer = 0; r.lianZhuang = 0;
  r.quanNo = 3; r.quanDealerCount = 1;
  nextRound(r, { draw: true, winnerSeat: -1 });
  ok(r.dealer === 0 && r.lianZhuang === 1, '流局庄家连庄', `${r.dealer}/${r.lianZhuang}`);
  ok(r.quanNo === 3 && r.quanDealerCount === 1, '流局不推进圈', `${r.quanNo}/${r.quanDealerCount}`);
}

// 4) 一圈 = 四家各坐一次庄：本圈第 4 个庄下庄 → 进下一圈
{
  const r = newRoom();
  r.roundNo = 8; r.dealer = 3; r.lianZhuang = 0;
  r.quanNo = 1; r.quanDealerCount = 4;
  nextRound(r, { draw: false, winnerSeat: 0 });
  ok(r.dealer === 0, '庄 3 的下家是 0', r.dealer);
  ok(r.quanNo === 2, '四家各坐一次庄后进入第 2 圈', r.quanNo);
  ok(r.quanDealerCount === 1, '新一圈从第 1 个庄重新计数', r.quanDealerCount);
}

// 5) 四圈最后一局判定：只有闲家胡且本圈第 4 庄才收将
{
  const r = newRoom();
  r.quanNo = 4; r.quanDealerCount = 4; r.dealer = 2;
  r.lastResult = { draw: false, winnerSeat: 0 };
  ok(r.isJiangLastGame() === true, '第 4 圈第 4 庄被闲家胡 → 本将最后一局');

  r.lianZhuang = 0;
  r.lastResult = { draw: false, winnerSeat: 2 };
  ok(r.isJiangLastGame() === false, '庄家自摸连庄 → 本将还没打完');

  r.lastResult = { draw: true, winnerSeat: -1 };
  ok(r.isJiangLastGame() === false, '流局连庄 → 本将还没打完');

  r.quanNo = 3; r.lastResult = { draw: false, winnerSeat: 0 };
  ok(r.isJiangLastGame() === false, '第 3 圈不触发结算');

  r.quanNo = 4; r.quanDealerCount = 3;
  ok(r.isJiangLastGame() === false, '第 4 圈还没轮到第 4 个庄');
}

// 6) 打完四圈开新一将：分数清零、圈回 1、换人起庄
{
  const r = newRoom();
  r.roundNo = 20; r.dealer = 2; r.lianZhuang = 2;
  r.quanNo = 4; r.quanDealerCount = 4;
  r.jiangNo = 1; r.jiangStartDealer = 0; r.jiangEnded = true;
  r.players.forEach((p, i) => { p.score = i * 10 - 15; });
  const res = r.startGame();
  ok(res.ok, '新一将能正常开局');
  ok(r.jiangNo === 2, '将数 +1', r.jiangNo);
  ok(r.quanNo === 1 && r.quanDealerCount === 1, '圈数回到第 1 圈重新起算', `${r.quanNo}/${r.quanDealerCount}`);
  ok(r.dealer === 1, '新一将换下一位起庄（也避免固定一家总坐首庄）', r.dealer);
  ok(r.lianZhuang === 0, '新一将连庄清零', r.lianZhuang);
  ok(r.jiangEnded === false, '结算标记已清除');
  ok(r.players.every((p) => p.score === 0), '新一将累计输赢清零', r.players.map((p) => p.score).join(','));
}

// 7) 换牌四家同花色 → 重摇，不涨连庄
{
  const r = newRoom();
  r.startGame();
  ok(r.phase === 'swap', '应进入换牌阶段', r.phase);
  const lz = r.lianZhuang;
  for (const p of r.players) {
    let put = 0;
    for (let i = 0; i < p.hand.length && put < 3; i++) if (p.hand[i] !== 0) { p.hand[i] = 0; put++; }
  }
  for (const p of r.players) r.doSwap(p.seat, 'm');
  ok(r.swapFail >= 1, '全同花色应记一次无效并重摇', r.swapFail);
  ok(r.lianZhuang === lz, '换牌无效不涨连庄（不是一局打完）', r.lianZhuang);
  ok(r.phase === 'swap', '重摇后回到换牌阶段', r.phase);
  if (r._swapTimer) { clearTimeout(r._swapTimer); r._swapTimer = null; }
}

// 8) 起始局初始化：第 1 圈、第 1 将、庄 0
{
  const r = newRoom();
  r.startGame();
  ok(r.quanNo === 1 && r.quanDealerCount === 1 && r.jiangNo === 1, '新桌从第 1 圈第 1 将开始', `${r.quanNo}/${r.quanDealerCount}/${r.jiangNo}`);
  ok(r.dealer === 0, '房主坐首庄', r.dealer);
  if (r._swapTimer) { clearTimeout(r._swapTimer); r._swapTimer = null; }
}

// 9) 真实胡牌流程会写出 jiangEnded（不是只在 helper 里成立）
{
  const r = newRoom();
  r.startGame();
  if (r._swapTimer) { clearTimeout(r._swapTimer); r._swapTimer = null; }
  r.phase = 'playing'; r.swap = null; r.joker = 26;
  r.dealer = 0; r.quanNo = 4; r.quanDealerCount = 4; r.turn = 1;
  r.pending = null; r.winners = null; r.opening = false; r.jinKanActive = false;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.flowerCount = 0;
    p.jinKan = false; p.lastDrawn = -1; p.declaredTing = false;
  });
  const p = r.getPlayer(1);
  p.hand = [0, 0, 0, 1, 2, 3, 9, 10, 11, 18, 19, 20, 21, 22, 23, 5, 5];
  p.flowerCount = 2;
  const res = r.doHu(1, true, 1, {});
  ok(res.ok, '闲家自摸应成立', res);
  ok(r.winners && r.winners.winner === 1, '胡家是闲家 1');
  ok(r.jiangEnded === true, '第 4 圈第 4 庄被闲家胡 → 写出本将结算标记', r.jiangEnded);
}

// 10) 庄家自摸（连庄）不触发本将结算
{
  const r = newRoom();
  r.startGame();
  if (r._swapTimer) { clearTimeout(r._swapTimer); r._swapTimer = null; }
  r.phase = 'playing'; r.swap = null; r.joker = 26;
  r.dealer = 1; r.quanNo = 4; r.quanDealerCount = 4; r.turn = 1;
  r.pending = null; r.winners = null; r.opening = false; r.jinKanActive = false;
  r.players.forEach((p) => {
    p.hand = []; p.melds = []; p.discards = []; p.flowerCount = 0;
    p.jinKan = false; p.lastDrawn = -1; p.declaredTing = false;
  });
  const p = r.getPlayer(1);
  p.hand = [0, 0, 0, 1, 2, 3, 9, 10, 11, 18, 19, 20, 21, 22, 23, 5, 5];
  p.flowerCount = 2;
  const res = r.doHu(1, true, 1, {});
  ok(res.ok, '庄家自摸应成立', res);
  ok(r.jiangEnded === false, '庄家连庄 → 本将没打完，不结算', r.jiangEnded);
}

// 11) 连续 16 局都由庄家下家胡 → 刚好四圈、每家各坐 4 次庄，最后收将
{
  const r = newRoom();
  r.startGame();
  if (r._swapTimer) { clearTimeout(r._swapTimer); r._swapTimer = null; }
  const dealers = [r.dealer];
  let endedAt = 0;
  for (let i = 0; i < 15; i++) {
    r.lastResult = { draw: false, winnerSeat: (r.dealer + 1) % 4 };
    r.jiangEnded = r.isJiangLastGame();
    if (r.jiangEnded) endedAt = i + 1;
    r.startGame();
    if (r._swapTimer) { clearTimeout(r._swapTimer); r._swapTimer = null; }
    dealers.push(r.dealer);
  }
  ok(dealers.every((d, i) => i === 0 || d === (dealers[i - 1] + 1) % 4), '庄家严格逆时针轮转', dealers.join('→'));
  ok(endedAt === 0, '前 15 局都还没打满四圈', endedAt);
  ok(r.quanNo === 4 && r.quanDealerCount === 4, '第 16 局是第 4 圈第 4 个庄', `${r.quanNo}/${r.quanDealerCount}`);
  r.lastResult = { draw: false, winnerSeat: (r.dealer + 1) % 4 };
  ok(r.isJiangLastGame() === true, '第 16 局（第 4 圈第 4 庄）被闲家胡 → 四圈打满，收将');
  ok(dealers.filter((d) => d === 0).length === 4, '每家各坐 4 次庄', dealers.filter((d) => d === 0).length);
}

console.log(`圈/将/换庄：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
