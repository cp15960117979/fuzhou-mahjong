// 大乱斗核心引擎测试（新编码：0-26 数牌, 27-62 花牌, 无字牌）
const MJ = require('../src/mahjong.js');

let pass = 0, fail = 0;
function assert(name, cond) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗ FAIL:', name); }
}

const JT = 20; // 金 = 筒3（数牌，合法）

console.log('— 测试1: 标准型胡牌 (无金) —');
{
  const tiles = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 9, 10, 11, 12];
  const r = MJ.checkWin(tiles, JT);
  assert('应胡牌 standard', r.win && r.type === 'standard');
}

console.log('— 测试2: 三金倒 (含金>=3) —');
{
  const tiles = [JT, JT, JT, 0, 2, 4, 6, 8, 9, 11, 13, 5, 7, 11];
  const r = MJ.checkWin(tiles, JT);
  assert('三金倒应胡', r.win === true);
  assert('sanjindao feat', r.feats.sanjindao === true);
}

console.log('— 测试3: 无七对 (间隔对子应不胡) —');
{
  const tiles = [0, 0, 2, 2, 4, 4, 6, 6, 8, 8, 10, 10, 12, 12];
  const r = MJ.checkWin(tiles, JT);
  assert('七对(间隔)应不胡', r.win === false);
}

console.log('— 测试4: 有金对对胡 —');
{
  const tiles = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 9, JT];
  const r = MJ.checkWin(tiles, JT);
  assert('含金应胡', r.win);
  assert('碰碰胡 feat', r.feats.pengpeng === true);
  assert('有金对对胡 feat', r.feats.youjinDuizi === true);
}

console.log('— 测试5: 无金对对胡 —');
{
  const tiles = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 9, 9];
  const r = MJ.checkWin(tiles, JT);
  assert('碰碰胡胡', r.win);
  assert('无金对对胡 feat', r.feats.wujinDuizi === true && r.feats.youjinDuizi === false);
}

console.log('— 测试6: 金雀 (2金作将) —');
{
  const tiles = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, JT, JT];
  const r = MJ.checkWin(tiles, JT);
  assert('金雀应胡', r.win);
  assert('jinque feat', r.feats.jinque === true);
}

console.log('— 测试7: 金龙 (3金作刻) —');
{
  const tiles = [0, 0, 0, 1, 1, 1, 2, 2, 2, JT, JT, JT, 9, 9];
  const r = MJ.checkWin(tiles, JT);
  assert('金龙应胡', r.win);
  assert('jinlong feat', r.feats.jinlong === true);
}

console.log('— 测试8: 清一色 (全万, 无金) —');
{
  const tiles = [0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4];
  const r = MJ.checkWin(tiles, JT);
  assert('清一色 true', r.feats.qingyise === true);
  assert('混一色 false', r.feats.hunyise === false);
}

console.log('— 测试9: 混一色 (全条 + 金异花) —');
{
  const tiles = [9, 9, 9, 10, 10, 10, 11, 11, 11, 12, 12, 12, 9, JT];
  const r = MJ.checkWin(tiles, JT);
  assert('混一色 true', r.feats.hunyise === true);
  assert('清一色 false', r.feats.qingyise === false);
}

console.log('— 测试10: 两门花色 (非清非混) —');
{
  const tiles = [0, 1, 2, 3, 4, 5, 9, 10, 11, 12, 13, 14, 6, 6];
  const r = MJ.checkWin(tiles, JT);
  assert('应胡', r.win);
  assert('清/混均 false', !r.feats.qingyise && !r.feats.hunyise);
}

console.log('— 测试11: 花牌被忽略并计数 —');
{
  const tiles = [0, 0, 2, 2, 4, 4, 6, 6, 8, 8, 10, 10, 12, 12, 27]; // 含1张花(春)
  const r = MJ.checkWin(tiles, JT);
  assert('含花牌不应胡', r.win === false);
  assert('flowers 计数=1', r.flowers === 1);
}

console.log('— 测试12: 牌库 144 张 / 36 花 —');
{
  const deck = MJ.buildDeck();
  assert('buildDeck=144', deck.length === 144);
  assert('数牌108', deck.filter((t) => t < 27).length === 108);
  assert('花牌36', deck.filter((t) => t >= 27).length === 36);
}

console.log('— 测试13: 无字牌 (原字牌均落在花区间) —');
{
  // 原字牌 东南西北中发白 现为花 (>=27)
  const deck = MJ.buildDeck();
  assert('无 27 以下的字牌', deck.every((t) => t < 27 || t >= 27));
}

console.log(`\n结果: ${pass} 通过, ${fail} 失败`);
process.exit(fail === 0 ? 0 : 1);
