// 换牌：手动挑 3 张时，"同点数的两张"必须按张区分（手里 3 7 7 8 万，只圈一张 7，而不是两张一起圈）
const { Room } = require('../src/game.js');
const MJ = require('../src/mahjong.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

const HAND = [3, 7, 7, 8, 9, 10, 11, 13, 14, 15, 18, 19, 20, 21, 22, 23];

function setup() {
  const r = new Room('SW');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  r.phase = 'swap';
  r.swap = { id: 1, diceSum: 8, dir: 'cw', choices: {}, picks: {} };
  r.joker = 26;
  r.players.forEach((p) => {
    p.hand = HAND.slice();
    p.melds = []; p.discards = []; p.flowerCount = 0;
  });
  return r;
}

// 1) 3 7 7 8 万，选 3/7/8 → 只换出这三张，手里剩下一张 7
{
  const r = setup();
  const res = r.doSwap(0, 'm', [3, 7, 8]);
  ok(res.ok, '提交 3/7/8 成功', JSON.stringify(res));
  ok(JSON.stringify(r.swap.picks[0]) === '[3,7,8]', '服务端记住的是 3/7/8', JSON.stringify(r.swap.picks[0]));
  ok(r.getPlayer(0).hand.filter((t) => t === 7).length === 2, '提交时还没动牌（等四家都选完才换）');
}

// 2) 选 7/7/8（两张 7 都换）也合法
{
  const r = setup();
  const res = r.doSwap(0, 'm', [7, 7, 8]);
  ok(res.ok, '提交 7/7/8 成功', JSON.stringify(res));
  ok(JSON.stringify(r.swap.picks[0]) === '[7,7,8]', '两张 7 都能换出', JSON.stringify(r.swap.picks[0]));
}

// 3) 选 7/7/7（手里只有两张）→ 不记录，退回自动取
{
  const r = setup();
  const res = r.doSwap(0, 'm', [7, 7, 7]);
  ok(res.ok, '提交不报错（只是不采纳手选）', JSON.stringify(res));
  ok(!r.swap.picks[0], '手里没有第三张 7，不记录选择', JSON.stringify(r.swap.picks[0]));
}

// 4) 混入别的花色 → 不记录
{
  const r = setup();
  r.doSwap(0, 'm', [3, 7, 9]); // 9 = 一条
  ok(!r.swap.picks[0], '含非本花色的牌不记录', JSON.stringify(r.swap.picks[0]));
}

// 5) 四家都选完：真正换出去的牌就是各自挑的那 3 张
{
  const r = setup();
  const before = r.swap;
  r.doSwap(0, 'm', [3, 7, 8]);
  r.doSwap(1, 'm', [3, 7, 8]);
  r.doSwap(2, 'm', [3, 7, 8]);
  r.doSwap(3, 'm', [3, 7, 8]);
  // 四家同花色 → 会判无效重摇；这里只关心"换出前手里少了哪三张"
  ok(r.swapFail === 1 && r.swap && r.swap !== before,
    '四家都选完立刻执行换牌（全同花色 → 无效重摇，换成新的一轮）',
    JSON.stringify({ fail: r.swapFail, same: r.swap === before }));
  // 下家（cw 方向 giveTo = seat-1）收到的是上家给的牌：座位 0 收到座位 3 的 3/7/8
  const p0 = r.getPlayer(0);
  ok([3, 7, 8].every((t) => p0.hand.includes(t)), '接收方拿到 3/7/8', JSON.stringify(p0.hand));
  ok(p0.hand.filter((t) => t === 7).length === 2, '换出再换回，7 仍是两张', JSON.stringify(p0.hand));
}

// 6) 只挑一张 7（不是两张）：换完后手里 7 的数量按差额变化
{
  const r = setup();
  // 只有座位 0 手选 3/7/8，其他家自动取（不传 tiles）
  r.doSwap(0, 'm', [3, 7, 8]);
  r.doSwap(1, 's');
  r.doSwap(2, 'p');
  r.doSwap(3, 's');
  const p0 = r.getPlayer(0);
  // 座位 0 交出 3/7/8 万，从座位 3 收到 3 张条子
  ok(p0.hand.length === 16, '换牌后手牌仍是 16 张', p0.hand.length);
  ok(!p0.hand.includes(3) && !p0.hand.includes(8), '手选的 3 万、8 万确实被换走了', JSON.stringify(p0.hand));
  ok(p0.hand.filter((t) => t === 7).length === 1, '只换走一张 7，手里还剩一张 7', JSON.stringify(p0.hand));
  ok(p0.hand.filter((t) => MJ.suitOf(t) === 's').length === 9, '收到 3 张条子（原有 6 张）',
    p0.hand.filter((t) => MJ.suitOf(t) === 's').length);
}

// 7) 换牌阶段不泄露别人选的花色（只公布"选好没"）
{
  const r = setup();
  r.doSwap(0, 'm', [3, 7, 8]);
  const st1 = r.getState(1); // 座位 1 看座位 0
  ok(!('choices' in st1.swap), 'state.swap 不再带 choices 字段', Object.keys(st1.swap));
  ok(!JSON.stringify(st1.swap).includes('"m"'), '别人看不到座位 0 选的是万', JSON.stringify(st1.swap));
  ok(st1.swap.yourChoice === null, '自己没选就是 null', st1.swap.yourChoice);
  ok(st1.swap.chosen && st1.swap.chosen[0] === true && st1.swap.chosen[1] === false,
    '只公布谁已选好（座位 0 已选、座位 1 未选）', JSON.stringify(st1.swap.chosen));
  // 自己仍然知道自己选了什么（用于回显/重连恢复）
  ok(r.getState(0).swap.yourChoice === 'm', '自己的选择仍然回显给自己', r.getState(0).swap.yourChoice);
}

// 8) 日志也不写花色（否则等于广播）
{
  const r = setup();
  r.doSwap(0, 'm', [3, 7, 8]);
  r.doSwap(1, 's');
  ok(!r.log.some((x) => x.includes('换出 万') || x.includes('换出 条') || x.includes('换出 筒')),
    '日志里没有"换出 X"这种花色字样', JSON.stringify(r.log));
  ok(r.log.some((x) => x.includes('已选好')), '日志只写"已选好要换出的 3 张"', JSON.stringify(r.log));
}

console.log(`\n换牌手选：${pass} 通过 / ${fail} 失败`);
process.exit(fail ? 1 : 0);
