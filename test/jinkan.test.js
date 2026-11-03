/* 金坎专项验证：宣告 / 亮牌 / 盖倒后只能摸打 / 摸金即胡 */
const { Room } = require('/workspace/fuzhou-mahjong/src/game.js');
const MJ = require('/workspace/fuzhou-mahjong/src/mahjong.js');

let pass = 0, fail = 0;
function T(name, cond, extra) {
  if (cond) { pass++; console.log('  ✓', name); }
  else { fail++; console.log('  ✗', name, extra !== undefined ? JSON.stringify(extra) : ''); }
}

function mkRoom(joker) {
  const room = new Room('JK');
  for (let i = 0; i < 4; i++) room.addPlayer(null, 'P' + i);
  room.players.forEach((p) => { p.isBot = false; });
  room.phase = 'playing';
  room.joker = joker;      // 25 = 八筒
  room.turn = 0;
  room.dealer = 0;
  room.wall = [];
  // 不让 nextTurn 真的给下家摸牌，便于单步验证
  room.nextTurn = function () { this.turn = (this.turn + 1) % 4; this.pending = null; };
  return room;
}

// 16 张卡金听牌形态（七筒 24 + 九筒 26 + 14 张成 4 组 1 将）—— 大乱斗是 16 张制
const TING13 = [0, 0, 0, 9, 9, 9, 18, 18, 18, 1, 2, 3, 4, 4, 24, 26];

console.log('— 1. 宣告金坎：亮出前后两张、中间留金位 —');
{
  const room = mkRoom(25);
  room.players[0].hand = TING13.slice();
  T('宣告前满足 canJinKan', room.canJinKan(room.players[0]));
  const r = room.declareJinKan(0);
  const p = room.players[0];
  T('宣告成功', r.ok, r);
  const m = p.melds.find((x) => x.type === 'jinkan');
  T('生成金坎副露', !!m);
  T('副露 = 七筒 / 金位 / 九筒', m && JSON.stringify(m.tiles) === JSON.stringify([24, 'J', 26]), m && m.tiles);
  T('手牌里不再有 七筒九筒', !p.hand.includes(24) && !p.hand.includes(26), p.hand);
  T('手牌 14 张（盖倒）', p.hand.length === 14, p.hand.length);
  T('标记 jinKan', p.jinKan === true);
  T('log 写明亮牌', room.log.some((s) => s.includes('亮出') && s.includes('七筒') && s.includes('九筒')));
}

console.log('— 2. 吃碰后（3n+2 多一张）也能宣告：自动打掉多余那张 —');
{
  const room = mkRoom(25);
  // 16 张听牌 + 一张多余的五万（=17 张，吃碰后待出牌的形态）
  room.players[0].hand = TING13.concat([5]).sort((a, b) => a - b);
  const p = room.players[0];
  T('canJinKan 识别吃碰后形态', room.canJinKan(p), p.hand.length);
  const r = room.declareJinKan(0);
  T('宣告成功', r.ok, r);
  T('多余的那张被自动打出', p.discards.length === 1, p.discards);
  T('副露已亮出 7 筒/金位/9 筒', p.melds.some((m) => m.type === 'jinkan' && m.tiles[1] === 'J'));
  T('宣告后手牌 14 张', p.hand.length === 14, p.hand.length);
}

console.log('— 2.5 多余的那张恰好是要亮的两张之一：打重复的，不能把自己亮坏 —');
{
  const room = mkRoom(25);
  // 17 张，多一张七筒：只能打掉这张重复的，剩下 1 张七筒 + 1 张九筒正好亮坎
  room.players[0].hand = TING13.concat([24]).sort((a, b) => a - b);
  const p = room.players[0];
  const r = room.declareJinKan(0);
  T('仍能宣告成功', r.ok, r);
  T('打掉的是一张重复的七筒', p.discards[p.discards.length - 1] === 24, p.discards);
  T('两张亮牌都从手牌移出', !p.hand.includes(24) && !p.hand.includes(26), p.hand);
  T('宣告后手牌 14 张（打 1 + 亮 2）', p.hand.length === 14, p.hand.length);
  T('整手张数没乱：14 + 亮出 2 张 = 16', room.fullTiles(p).length === 16, room.fullTiles(p).length);
  // 摸到金必须能胡（以前这里张数算错 → 永远胡不了 → 卡死）
  p.hand.push(25); p.lastDrawn = 25;
  const hr = room.doHu(0, true, 0, {});
  T('摸到金能正常胡（不会卡死）', hr.ok, hr);
  T('结算标记金坎', room.winners && room.winners.jinkan === true);
}

console.log('— 3. 手里有金 / 缺 7、9 筒 / 边张金 一律不能宣告 —');
{
  const room = mkRoom(25);
  room.players[0].hand = TING13.slice();
  room.players[0].hand[11] = 25; // 换成金
  T('手里有金 → canJinKan false', !room.canJinKan(room.players[0]));
  T('手里有金 → 宣告被拒', !room.declareJinKan(0).ok);

  const room2 = mkRoom(25);
  room2.players[0].hand = [0, 0, 0, 9, 9, 9, 18, 18, 18, 1, 1, 23, 24]; // 六筒七筒，缺九筒
  T('缺 9 筒 → 不能宣告', !room2.declareJinKan(0).ok);

  const room3 = mkRoom(18); // 金 = 一筒（边张）
  room3.players[0].hand = [0, 0, 0, 9, 9, 9, 19, 19, 19, 1, 1, 2, 3];
  T('边张金 → 不能宣告', !room3.declareJinKan(0).ok);
}

console.log('— 4. 宣告后：不吃不碰不杠、只能摸牌 —');
{
  const room = mkRoom(25);
  room.players[0].hand = TING13.slice();
  room.declareJinKan(0);
  room.jinKanActive = true;
  const p1 = room.players[1];
  p1.hand = [24, 24, 26, 26, 0, 0, 0, 9, 9, 9, 18, 18, 18, 1, 1, 2];
  T('别人打 7 筒，金坎者无任何响应', room.availableClaims(room.players[0], 24, 1).length === 0);
  T('全场金坎生效 → 其他人也不能吃碰杠', room.availableClaims(p1, 24, 2).length === 0);
  const st = room.getState(0);
  T('金坎者行动里没有 discard（不用挑牌）', !st.actions.includes('discard'), st.actions);
}

console.log('— 5. 摸到非金：原样打出，手牌张数不变，不能换牌 —');
{
  const room = mkRoom(25);
  room.players[0].hand = TING13.slice();
  room.declareJinKan(0);
  const p = room.players[0];
  room.wall = [4]; // 摸五万（非金）
  room.turn = 0;
  room.drawCurrent();
  T('非金自动打出', p.discards[p.discards.length - 1] === 4, p.discards);
  T('手牌仍是 14 张', p.hand.length === 14, p.hand.length);
  T('log 记录非金照打', room.log.some((s) => s.includes('非金照打')));
  const bad = room.discard(0, p.hand[0]);
  T('想换牌打别的 → 被拒', !bad.ok, bad.msg);
}

console.log('— 6. 摸到金：直接胡，计金坎 12 片 —');
{
  const room = mkRoom(25);
  room.players[0].hand = TING13.slice();
  room.declareJinKan(0);
  room.wall = [25]; // 摸八筒金
  room.turn = 0;
  room.drawCurrent();
  T('摸到金自动胡', room.phase === 'ended', room.phase);
  T('赢家是金坎者', room.winners && room.winners.winner === 0);
  T('结算标记 jinkan', room.winners && room.winners.jinkan === true);
  T('分数含「金坎（12）」', room.winners && room.winners.summary.includes('金坎（12）'), room.winners && room.winners.summary);
}

console.log('— 7. 亮的坎被别的顺子"借走"（牌型成立但金位没用上）→ 不能胡，也不能卡死 —');
{
  const room = mkRoom(4); // 金 = 五万，坎位 = 四万[金]六万
  const p = room.players[0];
  p.melds = [
    { type: 'peng', tiles: [1, 1, 1], from: 1 },
    { type: 'peng', tiles: [8, 8, 8], from: 2 },
    { type: 'peng', tiles: [25, 25, 25], from: 3 },
    { type: 'jinkan', tiles: [3, 'J', 5], from: -1 },
  ];
  p.jinKan = true; room.jinKanActive = true;
  p.hand = [0, 0, 1, 2, 6]; // 听牌形态（full 16）
  room.wall = [7];          // 摸 7 万：1-2-3 + 5-6-7 都能成，但金位（4）没用上
  room.turn = 0;
  const fake = [0, 0, 1, 2, 6, 7].concat([1, 1, 1, 8, 8, 8, 25, 25, 25, 3, 5]);
  T('（前提）宽松口径把这种牌判成胡了', MJ.checkWin(fake, 4).win === true);
  room.drawCurrent();
  T('金坎严格口径 → 不胡（以前这里会无限重试卡死）', room.phase !== 'ended', room.phase);
  T('selfCanHu 保持 false', room.selfCanHu === false);
  T('摸到的 7 万照原样打出', p.discards[p.discards.length - 1] === 7, p.discards);
  T('手牌回到 5 张（3 碰 9 张 + 5 = 听牌 16）', p.hand.length === 5, p.hand.length);
}
{
  const room = mkRoom(4);
  const p = room.players[0];
  p.melds = [
    { type: 'peng', tiles: [18, 18, 18], from: 1 },
    { type: 'peng', tiles: [19, 19, 19], from: 2 },
    { type: 'peng', tiles: [20, 20, 20], from: 3 },
    { type: 'jinkan', tiles: [3, 'J', 5], from: -1 },
  ];
  p.jinKan = true; room.jinKanActive = true;
  p.hand = [21, 22, 23, 24, 24]; // 四五六筒 + 七七筒将
  room.wall = [4];               // 摸金：四[金]六万 这一组真的用上了
  room.turn = 0;
  room.drawCurrent();
  T('真摸到金、坎位用上 → 胡', room.phase === 'ended', room.phase);
  T('赢家是金坎者', room.winners && room.winners.winner === 0);
}

console.log(`\n金坎专项：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
