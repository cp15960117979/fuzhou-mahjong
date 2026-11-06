// 开局发牌 / 换牌张数专项：
//   庄家发牌就多拿 1 张 = 17 张，换牌是从这 17 张里挑 3 张同花色换出（换回 3 张仍 17 张），
//   开金后**不再额外摸牌**，直接轮到庄家出牌。
//   顺带守住"换庄后第一个出牌的必须是新庄家"（以前 turn 没跟着庄家走，会把第 17 张发给别人）。
const { Room } = require('../src/game.js');
const MJ = require('../src/mahjong.js');

let pass = 0, fail = 0;
function ok(cond, name, extra) {
  if (cond) { pass++; console.log('✓', name); }
  else { fail++; console.log('✗', name, extra === undefined ? '' : extra); }
}

function newRoom() {
  const r = new Room('OP');
  for (let i = 0; i < 4; i++) r.addPlayer(null, 'P' + i);
  return r;
}

// 给某家挑一门"够 3 张"的花色
function suitsWith3(p) {
  const cnt = { m: 0, s: 0, p: 0 };
  for (const t of p.hand) { const s = MJ.suitOf(t); if (cnt[s] != null) cnt[s]++; }
  return Object.keys(cnt).filter((k) => cnt[k] >= 3).sort((a, b) => cnt[b] - cnt[a]);
}
function pickSuit(p) { return suitsWith3(p)[0]; }

// 1) 发牌：庄 17、闲 16，且轮到庄家
{
  const r = newRoom();
  r.startGame();
  ok(r.phase === 'swap', '进入换牌阶段', r.phase);
  ok(r.players[r.dealer].hand.length === 17, '庄家起手 17 张', r.players[r.dealer].hand.length);
  ok(r.players.filter((p) => p.seat !== r.dealer).every((p) => p.hand.length === 16), '三家闲家各 16 张',
    r.players.map((p) => p.hand.length).join(','));
  ok(r.turn === r.dealer, '轮到庄家（换完就由他先出牌）', `dealer=${r.dealer} turn=${r.turn}`);
}

// 2) 庄家从 17 张里挑 3 张换出，换完仍是 17 张；开金后不再摸牌
{
  let r = null, dealer = -1, suit = null, picks = null, otherSuits = null;
  // 想造一轮"一定换成功"的换牌（四家同花色会重摇），所以闲家尽量选与庄家不同的花色；
  //   极端手牌凑不出来就换一副牌重来（概率极低）
  for (let attempt = 0; attempt < 20 && !otherSuits; attempt++) {
    const cand = newRoom();
    cand.startGame();
    const d = cand.dealer;
    const ds = suitsWith3(cand.players[d]);
    const others = cand.players.filter((p) => p.seat !== d);
    for (const s of ds) {
      const os = others.map((p) => suitsWith3(p).find((x) => x !== s));
      if (os.every(Boolean)) {
        r = cand; dealer = d; suit = s;
        picks = cand.players[d].hand.filter((t) => MJ.suitOf(t) === s).slice(0, 3);
        otherSuits = os;
        break;
      }
    }
  }
  ok(!!r, '构造出一副可以正常换牌的开局（庄家 17 张）');
  const before = r.players[dealer].hand.slice();
  ok(before.length === 17, '换牌前庄家 17 张', before.length);
  ok(picks.every((t) => MJ.suitOf(t) === suit), '挑的 3 张都是同一门花色', JSON.stringify(picks));
  r.doSwap(dealer, suit, picks);
  r.players.filter((p) => p.seat !== dealer).forEach((p, i) => r.doSwap(p.seat, otherSuits[i]));
  ok(r.phase === 'playing', '换牌完成 → 开金进入出牌', r.phase);
  ok(r.players[dealer].hand.length === 17, '换完庄家仍是 17 张', r.players[dealer].hand.length);
  ok(r.players.filter((p) => p.seat !== dealer).every((p) => p.hand.length === 16), '闲家仍各 16 张',
    r.players.map((p) => p.hand.length).join(','));
  ok(r.turn === dealer, '换完后轮到庄家出牌', `dealer=${dealer} turn=${r.turn}`);
  ok(r.players[dealer].lastDrawn === -1, '庄家 17 张里没有"刚摸的那张"', r.players[dealer].lastDrawn);
  ok(r.opening === true, '抢金窗口已打开');
  // 打出一张 → 变 16 张，并且是抢金窗口
  const t0 = r.players[dealer].hand[0];
  const res = r.discard(dealer, t0);
  ok(res.ok, '庄家能正常打出首张', res.msg);
  ok(r.players[dealer].hand.length === 16, '打出后庄家 16 张', r.players[dealer].hand.length);
}

// 3) 天胡：开金时 17 张就成牌 → selfCanHu + 天胡，不需要"摸第 17 张"
{
  const r = newRoom();
  r.startGame();
  const dealer = r.dealer;
  r.players.forEach((p) => { p.hand = []; });
  // 0-14 万三组顺子 + 条三组 + 21 对将（21 重复摆两张，仅测试用）
  r.players[dealer].hand = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 21, 21];
  r.players.forEach((p) => { if (p.seat !== dealer) p.hand = [0, 2, 4, 6, 8, 9, 11, 13, 18, 20, 22, 24, 36, 38, 40, 42]; });
  r.wall = [10, 11, 12, 26]; // 最后一张 pop 出来当金（26 = 九筒）
  r.openJokerAndStart();
  ok(r.joker === 26, '公示金是九筒', r.joker);
  ok(r.players[dealer].hand.length === 17, '开金后庄家仍 17 张（没多摸）', r.players[dealer].hand.length);
  ok(r.selfCanHu === true, '系统识别到庄家已可胡', r.selfCanHu);
  ok(r.isTianHu(dealer) === true, '这是天胡', r.isTianHu(dealer));
  const st = r.getState(dealer);
  ok((st.players[dealer].huInfo || {}).labels.includes('天胡'), '胡按钮写「天胡」', st.players[dealer].huInfo);
  const hr = r.selfHu(dealer);
  ok(hr.ok && r.winners && r.winners.tianhu === true, '天胡成立', hr.msg || '');
}

// 4) 换庄后：新庄家拿 17 张，且第一个出牌的是他（不是一个"残留的 turn"）
{
  const r = newRoom();
  r.roundNo = 3;           // 假装已经打了几局
  r.dealer = 2;            // 换庄到座位 2
  r.turn = 1;              // 换庄前残留的 turn（以前会把第 17 张发给 1）
  r.startGame();
  ok(r.dealer === 2 && r.turn === 2, '新庄家 = 出牌者', `dealer=${r.dealer} turn=${r.turn}`);
  ok(r.players[2].hand.length === 17, '新庄家 17 张', r.players[2].hand.length);
  ok(r.players[0].hand.length === 16 && r.players[1].hand.length === 16 && r.players[3].hand.length === 16,
    '其余三家 16 张', r.players.map((p) => p.hand.length).join(','));
}

console.log(`\n开局发牌/换牌：${pass} 通过 / ${fail} 失败`);
if (fail > 0) process.exit(1);
