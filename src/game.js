/**
 * 福麻大乱斗学习模拟器 — 房间与游戏状态机（后端权威逻辑）
 * 仅大乱斗模式。
 */
const MJ = require('./mahjong.js');

function uid() { return Math.random().toString(36).slice(2, 8); }
function sortHand(hand, joker) {
  return hand.slice().sort((a, b) => {
    const ja = a === joker ? 1 : 0, jb = b === joker ? 1 : 0;
    if (ja !== jb) return ja - jb; // 金排末尾
    return a - b;
  });
}
function roll2() { return 1 + Math.floor(Math.random() * 6) + 1 + Math.floor(Math.random() * 6); }
const PENDING_TIMEOUT_MS = Number((typeof process !== 'undefined' && process.env && process.env.PENDING_TIMEOUT_MS) || 0) || 30000; // 响应超时兜底

const SWAP_TIMEOUT_MS = Number((typeof process !== 'undefined' && process.env && process.env.SWAP_TIMEOUT_MS) || 0) || 30000; // 换牌超时兜底

function suitName(s) { return { m: '万', s: '条', p: '筒' }[s] || s; }
function dirText(dir) {
  return { cw: '顺时针 · 每人给上家', ccw: '逆时针 · 每人给下家', pair: '对家互换 · 每人给对家' }[dir] || dir;
}

class Room {
  constructor(id) {
    this.id = id;
    this.players = []; // {pid,name,seat,hand,melds,discards,flowerCount,connected,isHost,ws,
    //   eatPongCount,providers,declaredTing,jinKan}
    this.phase = 'waiting';
    this.wall = [];
    this.joker = -1;
    this.turn = 0;
    this.dealer = 0;
    this.lastDiscard = null;
    this.pending = null;
    this.winners = null;
    this.log = [];
    this.selfCanHu = false;
    this.opening = false; // 开局抢金窗口
    this.swap = null;     // {id,diceSum,dir,choices:{seat:suit|null}}
    this.swapSeq = 0;     // 换牌轮次编号（每次重摇换牌 +1，前端据此重置本地选择）
    this._swapTimer = null;
    this.lianZhuang = 0;  // 连庄数(本局计分用)
    this.dealDice = 0;
    this.roundNo = 0;
    // 圈 / 将：一圈 = 四家各坐一次庄（逆时针轮），四圈 = 一将，打完结算一次
    this.quanNo = 1;           // 第几圈（1-4）
    this.quanDealerCount = 1;  // 本圈已坐庄的庄数（当前庄算第 1 个）
    this.jiangNo = 1;          // 第几将
    this.jiangStartDealer = 0; // 本将起始庄（新一将回到这里重新起圈）
    this.jiangEnded = false;   // 本局打完四圈 → 本将结算
    this.lastResult = null; // {winnerSeat,draw}
    this.jinKanActive = false; // 有人声明金坎 → 全场只能自摸
    // v11：事件流。动作发生时 push 一条，跟着下一次 state 广播一起下发，
    //   前端据此放音效/播特效（不靠 diff 状态猜，碰/杠/大牌才能区分得清）。
    this.events = [];
    this.evSeq = 0;
  }

  emit(ev) {
    this.events.push({ ...ev, seq: ++this.evSeq });
    if (this.events.length > 40) this.events.shift();
  }

  // 快捷表情：不做进状态快照，直接广播一条轻量消息（不触发整页重绘）
  sendEmoji(seat, id) {
    const OK = ['hurry', 'help', 'kneel', 'who'];
    if (!OK.includes(id)) return { ok: false, msg: '没有这个表情' };
    const p = this.getPlayer(seat);
    if (!p) return { ok: false, msg: '座位不存在' };
    const now = Date.now();
    if (p.lastEmojiAt && now - p.lastEmojiAt < 900) return { ok: false, msg: '发得太快了' };
    p.lastEmojiAt = now;
    const msg = JSON.stringify({ t: 'emoji', seat, id, name: p.name });
    for (const pl of this.players) {
      if (pl.ws && pl.connected) {
        try { pl.ws.send(msg); } catch (e) { /* ignore */ }
      }
    }
    return { ok: true };
  }

  addPlayer(ws, name) {
    if (this.players.length >= 4) return { ok: false, msg: '房间已满(4人)' };
    if (this.phase !== 'waiting') return { ok: false, msg: '游戏已开始, 无法加入' };
    const seat = this.players.length;
    const player = {
      pid: uid(), name: name || ('玩家' + (seat + 1)), seat,
      hand: [], melds: [], discards: [], flowerCount: 0, connected: true,
      isHost: seat === 0, ws, eatPongCount: 0, providers: [], declaredTing: false, jinKan: false,
      score: 0, // 跨局累计输赢（片）
    };
    this.players.push(player);
    return { ok: true, pid: player.pid, seat };
  }

  removePlayer(pid) {
    const p = this.players.find((x) => x.pid === pid);
    if (p) { p.connected = false; p.ws = null; }
    this.broadcast();
  }

  // 等待阶段主动退出：把座位让出来，回大厅重新建房
  // 关键：重排座位后必须同步每个连接上的 ws.seat，否则 server 端 ws.seat 还是旧号，操作会错位
  leaveWaiting(pid) {
    if (this.phase !== 'waiting') return { ok: false, msg: '对局已开始，不能退出' };
    const idx = this.players.findIndex((x) => x.pid === pid);
    if (idx < 0) return { ok: false, msg: '不在这个房间' };
    const me = this.players[idx];
    if (me.ws) { me.ws.seat = null; me.ws.pid = null; me.ws.roomId = null; }
    this.players.splice(idx, 1);
    // 真人排在前面：房主必须是 seat 0，否则 server 的「只有房主能开始」判断会失效
    const humans = this.players.filter((p) => !p.isBot);
    const bots = this.players.filter((p) => p.isBot);
    this.players = humans.concat(bots);
    this.players.forEach((p, i) => {
      p.seat = i;
      p.isHost = i === 0;
      if (p.ws) p.ws.seat = i;
    });
    this.broadcast();
    return { ok: true, humans: humans.length, seats: this.players.length };
  }

  // ---------- 机器人（学习练习用） ----------
  addBot() {
    if (this.players.length >= 4) return { ok: false, msg: '房间已满(4人)' };
    if (this.phase !== 'waiting') return { ok: false, msg: '游戏已开始, 无法添加' };
    const res = this.addPlayer(null, '机器人' + '甲乙丙丁'[this.players.filter((p) => p.isBot).length]);
    if (res.ok) this.getPlayer(res.seat).isBot = true;
    this.broadcast();
    return res;
  }

  removeBot() {
    if (this.phase !== 'waiting') return { ok: false, msg: '游戏已开始, 无法移除' };
    const idx = this.players.map((p) => p.isBot).lastIndexOf(true);
    if (idx < 0) return { ok: false, msg: '没有机器人' };
    this.players.splice(idx, 1);
    // 重排座位（等待阶段重排不影响对局）
    this.players.forEach((p, i) => { p.seat = i; p.isHost = i === 0; });
    this.broadcast();
    return { ok: true };
  }

  // 广播后调度机器人行动（延迟拟人节奏）
  scheduleBots() {
    if (this._botTimers) for (const t of Object.values(this._botTimers)) clearTimeout(t);
    this._botTimers = {};
    if (this.phase !== 'playing' && this.phase !== 'swap') return;
    const bot = require('./bot.js');
    for (const p of this.players) {
      if (!p.isBot || !p.connected) continue;
      const st = this.getState(p.seat);
      const hasAct = (st.actions && st.actions.length > 0) ||
        (st.pending && st.pending.seats.includes(p.seat));
      if (!hasAct) continue;
      const timer = setTimeout(() => {
        try { bot.botDecide(this, p.seat); } catch (e) { /* 机器人出错不影响对局 */ }
      }, 400 + Math.floor(Math.random() * 700));
      if (timer.unref) timer.unref(); // 不阻塞进程退出
      this._botTimers[p.seat] = timer;
    }
  }

  getPlayer(seat) { return this.players[seat]; }

  // 完整手牌(暗牌 + 已亮明子), 用于胡牌/听牌判定
  // ⚠️ 杠(4 张)在"牌型"里只占 3 张：多出来的那张是杠本身的第 4 张，
  //   不参与凑面子。若 4 张全算进去，杠过一手后整手就是 18 张，
  //   need=(18-2)/3 不是整数 → 永远凑不出"5 面子+将"，杠完就再也胡不了。
  fullTiles(p) {
    const t = p.hand.slice();
    for (const m of p.melds) {
      const n = m.tiles.length === 4 ? 3 : m.tiles.length; // 杠按 3 张计
      for (let i = 0; i < n; i++) if (m.tiles[i] !== 'J') t.push(m.tiles[i]);
    }
    return t;
  }

  // ---------- 胡牌 / 听牌判定（副露感知） ----------
  // 亮出去的吃碰杠是"定死的面子"，不能倒回手里重排。
  //   否则 碰了九条×3 + 手里 12345条 会被拼成 123/456/789 + 99 将（借走碰出的两张）→ 假胡。
  checkWinOf(p, extra = [], opts = {}) {
    const hand = (extra && extra.length) ? p.hand.concat(extra) : p.hand.slice();
    return MJ.checkWinEx(hand, p.melds, this.joker, opts);
  }
  isTingOf(p) { return MJ.isTingEx(p.hand, p.melds, this.joker); }
  labelsOf(p, extra = [], opts = {}) { return MJ.labelsOf(this.checkWinOf(p, extra, opts)); }

  // ---------- 天胡（庄家开局第一手就成牌） ----------
  // 结构判定，不靠标记位：全场还没人打过牌、也没人吃碰杠 → 这就是开金后庄家的第一手。
  //   条件：庄家、17 张、无副露、无金坎、当前无待响应。
  isTianHu(seat) {
    if (this.phase !== 'playing' || this.pending) return false;
    if (!this.opening) return false; // 抢金窗口 = 庄家还没打出第一张牌
    if (seat !== this.dealer) return false;
    const p = this.getPlayer(seat);
    if (!p || p.jinKan || p.melds.length > 0) return false;
    if (p.hand.length !== 17) return false;
    return this.players.every((x) => x.discards.length === 0 && x.melds.length === 0);
  }

  // 天胡成立还要"真的成牌"：
  //   三金倒只是"手里 3 张金就算胡"，并没有成牌 → 不算天胡；
  //   手里 3 张金又能成牌（金当刻子 + 其余成 4 面子 + 将）= 金龙 → 才叫「天胡金龙」。
  //   0~2 金的正常成牌 → 天胡。
  isTianHuWin(p) {
    if (!p || !this.isTianHu(p.seat)) return false;
    const r = this.checkWinOf(p);
    if (!r.win || r.type !== 'standard') return false;
    const golds = p.hand.filter((t) => t === this.joker).length;
    return golds < 3 || !!(r.feats || {}).jinlong;
  }

  // ---------- 开始游戏（仅大乱斗） ----------
  startGame() {
    const n = this.players.length;
    if (n < 4) return { ok: false, msg: '大乱斗需要 4 人' };
    // 连庄/庄家传承（首局由房主坐庄）
    if (this.roundNo === 0) {
      this.dealer = 0; this.lianZhuang = 0;
      this.quanNo = 1; this.quanDealerCount = 1;
      this.jiangNo = 1; this.jiangStartDealer = 0; this.jiangEnded = false;
      for (const p of this.players) p.score = 0; // 新开一桌 → 累计输赢清零
    }
    else if (this.jiangEnded) {
      // 上一局打完刚好满四圈 → 本将结算完毕，开新一将：重新记分、重新起圈
      this.jiangNo += 1;
      this.jiangStartDealer = (this.jiangStartDealer + 1) % n; // 新一将换个人起庄，长期更公平
      this.dealer = this.jiangStartDealer;
      this.quanNo = 1; this.quanDealerCount = 1;
      this.lianZhuang = 0; this.jiangEnded = false;
      for (const p of this.players) p.score = 0;
    }
    else if (this.lastResult) {
      if (this.lastResult.draw || this.lastResult.winnerSeat === this.dealer) {
        this.lianZhuang += 1; // 庄家胡/臭庄 → 连庄累计
      } else {
        // 闲家胡 → 庄家下庄：**逆时针轮到下家坐庄**（不是胡牌的人坐庄）
        //   每个人都做过一次庄 = 一圈；一圈走完自动进下一圈，四圈打完即一将结束
        this.dealer = (this.dealer + 1) % n;
        this.lianZhuang = 0;
        this.quanDealerCount += 1;
        if (this.quanDealerCount > 4) {
          this.quanDealerCount = 1;
          this.quanNo += 1;
        }
      }
    }
    this.roundNo += 1;

    this.phase = 'playing';
    this.wall = MJ.shuffle(MJ.buildDeck());
    // 第一次摇骰：定抓牌位置（跳过若干张后开始发）
    this.dealDice = roll2();
    const offset = this.dealDice % this.wall.length;
    this.wall = this.wall.slice(offset).concat(this.wall.slice(0, offset));
    // 发牌：庄最后抓，庄 17 / 闲 16
    const order = [(this.dealer + 1) % n, (this.dealer + 2) % n, (this.dealer + 3) % n, this.dealer];
    for (const p of this.players) { p.hand = []; p.melds = []; p.discards = []; p.flowerCount = 0; p.eatPongCount = 0; p.providers = []; p.declaredTing = false; p.jinKan = false; p.lastDrawn = -1; }
    for (let r = 0; r < 4; r++) for (const s of order) this.players[s].hand.push(...this.wall.splice(0, 4));
    // 庄家多 1 张：发完 16 张后庄家再拿 1 张 = 17 张。
    //   换牌阶段就是从这 17 张里挑 3 张换出（换回 3 张仍是 17 张），
    //   换完直接出牌，开金后不再额外摸一张。
    this.players[this.dealer].hand.push(this.wall.shift());
    this.turn = this.dealer; // 换牌/开金之后第一个出牌的就是庄家
    this.joker = -1;
    this.lastDiscard = null;
    this.pending = null;
    this.winners = null;
    this.opening = false;
    this.jinKanActive = false;
    this.swapFail = 0;
    this.clearSwapTimer();
    this.log = [`第${this.roundNo}局 · 庄: ${this.players[this.dealer].name} · 摇骰${this.dealDice}定抓牌`];
    this.buflower();
    this.log.push('补花完成');
    this.emit({ ev: 'deal', dealer: this.dealer });

    // 第二次摇骰：换牌方向
    this.computeSwapDice();
    this.broadcast();
    return { ok: true };
  }

  // 补花：手牌花牌移出计分，从牌尾补；循环
  buflower() {
    let changed = true;
    while (changed) {
      changed = false;
      for (const p of this.players) {
        let idx;
        while ((idx = p.hand.findIndex((t) => MJ.isFlower(t))) >= 0) {
          p.hand.splice(idx, 1);
          p.flowerCount++; // 这张花只计一次
          changed = true;
          if (this.wall.length === 0) continue; // 牌墙空了补不出牌（开局不会发生），别把花留在手里
          // 补到的若是花，下一轮循环会把它移出来再计一次——这里**不能**再 flowerCount++，
          //   否则一张花算两朵，四家花数合计会超过 36（总分虚高）
          p.hand.push(this.wall.pop());
        }
      }
    }
    for (const p of this.players) p.hand = sortHand(p.hand, this.joker < 0 ? 999 : this.joker);
  }

  // 第二次摇骰 → 换牌方向（5/9 重摇）
  computeSwapDice() {
    for (let attempt = 0; attempt < 30; attempt++) {
      const d1 = 1 + Math.floor(Math.random() * 6);
      const d2 = 1 + Math.floor(Math.random() * 6);
      const sum = d1 + d2;
      if (sum === 5 || sum === 9) continue; // 重摇
      let dir;
      if (sum === 3 || sum === 7 || sum === 11) dir = 'pair';
      else if (sum === 2 || sum === 6 || sum === 10) dir = 'ccw';
      else dir = 'cw'; // 4/8/12
      // dice 两颗点数单独下发，前端按真实骰面播动画（和值仍是 diceSum）
      this.swap = { id: ++this.swapSeq, diceSum: sum, dice: [d1, d2], dir, choices: {}, picks: {} };
      this.phase = 'swap';
      this.log.push(`换牌：摇出 ${d1} + ${d2} = ${sum} 点 → ${dirText(dir)}`);
      this.emit({ ev: 'dice', dice: [d1, d2], sum, dir });
      this.armSwapTimeout();
      return;
    }
    // 多次重摇无果：直接进入开金
    this.swap = null;
    this.openJokerAndStart();
  }

  // 换牌超时兜底：30 秒内有人没选（掉线/卡面板），自动替他选最多的一种花色，避免整局卡死
  armSwapTimeout() {
    if (this._swapTimer) clearTimeout(this._swapTimer);
    this._swapTimer = setTimeout(() => {
      if (this.phase !== 'swap' || !this.swap) return;
      const missing = this.players.filter((pl) => this.swap.choices[pl.seat] == null && !pl.isBot);
      if (!missing.length) return;
      let acted = false;
      for (const pl of missing) {
        const cnt = { m: 0, s: 0, p: 0 };
        for (const t of pl.hand) { const s = MJ.suitOf(t); if (cnt[s] != null) cnt[s]++; }
        const suits = ['m', 's', 'p'].sort((a, b) => cnt[b] - cnt[a]);
        if (cnt[suits[0]] < 3) continue;
        if (!acted) this.log.push('换牌超时：未选择的花色已自动换出（下次请及时选牌）');
        this.doSwap(pl.seat, suits[0]);
        acted = true;
      }
      if (acted) this.broadcast();
    }, SWAP_TIMEOUT_MS);
    if (this._swapTimer.unref) this._swapTimer.unref();
  }

  clearSwapTimer() {
    if (this._swapTimer) { clearTimeout(this._swapTimer); this._swapTimer = null; }
  }

  pairOf(seat) { // 庄↔对、上↔下
    if (seat === this.dealer) return (this.dealer + 2) % this.players.length;
    if (seat === (this.dealer + 2) % this.players.length) return this.dealer;
    if (seat === (this.dealer + 1) % this.players.length) return (this.dealer + 3) % this.players.length;
    return (this.dealer + 1) % this.players.length; // 上家
  }

  // 本次换牌，座位上这个人把 3 张牌给谁：{ seat, rel:'上家'|'下家'|'对家', name }
  swapGiveTo(seat) {
    if (!this.swap) return null;
    const dir = this.swap.dir;
    const target = this.swapTargetOf(seat);
    const rel = dir === 'cw' ? '上家' : dir === 'ccw' ? '下家' : '对家';
    const p = this.getPlayer(target);
    return { seat: target, rel, name: p ? p.name : '' };
  }

  swapTargetOf(seat) {
    const n = this.players.length;
    const dir = this.swap.dir;
    if (dir === 'cw') return (seat - 1 + n) % n;   // 顺时针：给上家
    if (dir === 'ccw') return (seat + 1) % n;      // 逆时针：给下家
    return (seat + 2) % n;                         // 对家互换
  }

  // 玩家各自选换出花色（每人 3 张）。集齐 4 人后执行环交换
  doSwap(seat, suit, tiles) {
    if (this.phase !== 'swap' || !this.swap) return { ok: false, msg: '非换牌阶段' };
    const p = this.getPlayer(seat);
    const cnt = p.hand.filter((t) => MJ.suitOf(t) === suit).length;
    if (cnt < 3) return { ok: false, msg: '该花色不足 3 张' };
    // 玩家手动挑选的 3 张（不传则按该花色前 3 张自动取，机器人走这条路）
    if (Array.isArray(tiles) && tiles.length === 3) {
      const hand = p.hand.slice();
      const okPick = tiles.every((t) => {
        const i = hand.indexOf(t);
        if (i < 0 || MJ.suitOf(t) !== suit) return false;
        hand.splice(i, 1);
        return true;
      });
      if (okPick) { this.swap.picks = this.swap.picks || {}; this.swap.picks[seat] = tiles.slice(); }
    }
    this.swap.choices[seat] = suit;
    // 只公布"已选好"，不公布选了哪一门：否则后面选的人能针对性避开 / 对冲（等于提前看牌）
    this.log.push(`${p.name} 已选好要换出的 3 张`);
    const allChosen = this.players.every((pl) => this.swap.choices[pl.seat] != null);
    if (!allChosen) { this.broadcast(); return { ok: true }; }
    this.executeSwapRing();
    return { ok: true };
  }

  executeSwapRing() {
    const n = this.players.length;
    const dir = this.swap.dir;
    const givens = this.swap.choices;
    const giveTo = (s) => this.swapTargetOf(s);
    // 取 3 张并交换
    const taken = {};
    for (const p of this.players) {
      const suit = givens[p.seat];
      const out = [];
      const picked = (this.swap && this.swap.picks && this.swap.picks[p.seat]) || [];
      for (const t of picked) {
        const i = p.hand.indexOf(t);
        if (i >= 0 && out.length < 3) out.push(p.hand.splice(i, 1)[0]);
      }
      while (out.length < 3) {
        const idx = p.hand.findIndex((t) => MJ.suitOf(t) === suit);
        if (idx < 0) break;
        out.push(p.hand.splice(idx, 1)[0]);
      }
      taken[p.seat] = out;
    }
    for (const p of this.players) p.hand.push(...taken[giveTo(p.seat)]);
    for (const p of this.players) p.hand = sortHand(p.hand, 999);
    this.log.push('换牌完成');
    // 成功判定：有人收到花色 ≠ 给出花色 → 成功；四家全一致 → 本轮无效，重摇骰子
    const received = {};
    for (const p of this.players) received[p.seat] = givens[giveTo(p.seat)];
    const success = this.players.some((p) => received[p.seat] !== givens[p.seat]);
    if (!success) {
      // 四家给的都是同一门花色 → 等于没换，重摇骰子再来一次。
      //   这是局内换牌环节的无效轮，**不是一局打完**，所以不涨连庄（连庄只由庄家胡/流局产生）。
      this.swapFail = (this.swapFail || 0) + 1;
      this.swap = null;
      if (this.swapFail >= 200) {
        // 极端兜底：200 次都同花色（人类会换门，基本只可能是全机器人卡死），跳过换牌
        this.swapFail = 0;
        this.log.push('换牌连续无效 200 次，跳过换牌直接开金');
        this.openJokerAndStart();
        return;
      }
      this.log.push(`换牌四家同花色 → 无效，重摇骰子（第${this.swapFail}次）`);
      this.computeSwapDice(); // 重新摇骰换牌
      this.broadcast();
      return;
    }
    this.swapFail = 0;
    this.swap = null;
    this.emit({ ev: 'swap' });   // 换牌真正落地，才有"换牌完成"的音效
    this.openJokerAndStart();
  }

  // 开金 + 进入 playing（+抢金窗口）
  openJokerAndStart() {
    this.clearSwapTimer();
    let guard = 0;
    while (this.wall.length > 0 && guard < 80) {
      const t = this.wall.pop();
      if (MJ.isFlower(t)) { this.players[this.dealer].flowerCount++; guard++; continue; }
      this.joker = t; // 翻出金（1 张公共展示，其余 3 张为百搭在场）
      break;
    }
    this.phase = 'playing';
    this.opening = true; // 抢金窗口
    this.log.push(`金: ${MJ.TILE_NAMES[this.joker]}（公共展示1张，场下3张百搭）`);
    this.emit({ ev: 'joker', tile: this.joker });
    // 庄家开局就是 17 张（发牌时就多拿 1 张，换牌从 17 张里挑 3 张），
    //   所以这里**不再摸牌**，直接轮到庄家出牌；天胡就在这一刻判定。
    this.turn = this.dealer;
    this.pending = null;
    this.lastDiscard = null;
    const dp = this.getPlayer(this.dealer);
    dp.lastDrawn = -1; // 17 张里没有"刚摸的那张"，不需要单独摆出来
    this.selfCanHu = this.checkWinOf(dp).win;
    this.broadcast();
  }

  drawCurrent() {
    const p = this.getPlayer(this.turn);
    if (this.wall.length === 0) { this.endDraw(); return; }
    let tile = this.wall.pop();
    // 摸到花牌：计分并继续补摸，直到摸到数牌
    while (MJ.isFlower(tile)) {
      p.flowerCount++;
      this.log.push(`${p.name} 摸花补花`);
      if (this.wall.length === 0) { this.endDraw(); return; }
      tile = this.wall.pop();
    }
    p.hand.push(tile);
    p.hand = sortHand(p.hand, this.joker);
    p.lastDrawn = tile;
    this.lastDiscard = null;
    this.pending = null;
    this.emit({ ev: 'draw', seat: this.turn });
    // 自摸 / 抢金 判定
    const r = this.checkWinOf(p);
    // 金坎家：坎位（lo-金-hi）是锁定的，必须真摸到金、且剩下 14 张自己凑成 4 面子+将。
    //   不能拿宽松的 checkWin 口径 —— 亮的 lo/hi 可能被别的组合"借用"（如 123 + 567），
    //   这时牌型看着成立，但其实金位根本没用到，会跟 doHu 的"必须有金"打架 → 无限重试卡死。
    this.selfCanHu = p.jinKan ? this.jinKanWin(p) : r.win;
    // 金坎：手牌已盖倒，只摸不挑 —— 摸到金立即胡；摸到别的牌必须原样打掉（不能换牌）
    if (p.jinKan && this.phase === 'playing') {
      if (this.selfCanHu) {
        const hr = this.doHu(this.turn, true, this.turn, {});
        if (hr.ok) return;
        // 兜底：摸到金却胡不了，绝不把金打出去（金坎的坎位必须靠金补）
        this.log.push(`${p.name}（金坎）摸到 ${MJ.TILE_NAMES[tile]} 但牌型未成立，请检查`);
        this.broadcast();
        return;
      }
      this.log.push(`${p.name}（金坎）摸到 ${MJ.TILE_NAMES[tile]}，非金照打`);
      const dr = this.discard(this.turn, tile);
      if (!dr.ok) this.broadcast();
      return;
    }
    this.broadcast();
  }

  endDraw() {
    this.phase = 'ended';
    this.winners = { draw: true };
    this.lastResult = { draw: true, winnerSeat: -1 };
    this.jiangEnded = this.isJiangLastGame();
    this.log.push('牌墙摸完，臭庄（流局，庄连庄）');
    this.emit({ ev: 'drawgame' });
    this.broadcast();
  }

  // 本局打完后，四圈是否刚好走完（四圈 = 一将，打完结算一次）
  //   只有闲家胡才会换庄、推进圈；庄家胡或流局都是连庄，圈不动。
  isJiangLastGame() {
    if (this.quanNo !== 4 || !this.lastResult) return false;
    if (this.lastResult.draw || this.lastResult.winnerSeat === this.dealer) return false;
    return this.quanDealerCount >= 4;
  }

  // ---------- 出牌 ----------
  discard(seat, tile) {
    if (this.phase !== 'playing') return { ok: false, msg: '游戏未在进行' };
    if (seat !== this.turn) return { ok: false, msg: '还没轮到你' };
    if (this.pending) return { ok: false, msg: '请先处理碰杠胡' };
    const p = this.getPlayer(seat);
    // 金坎：手牌已盖倒，只能打刚摸到的那张，不能挑牌
    if (p.jinKan && tile !== p.lastDrawn) return { ok: false, msg: '金坎只能打刚摸到的那张牌' };
    const idx = p.hand.indexOf(tile);
    if (idx < 0) return { ok: false, msg: '你手里没有这张牌' };
    p.hand.splice(idx, 1);
    p.discards.push(tile);
    p.lastDrawn = -1; // 打出去后不再有"刚摸的那张"
    this.lastDiscard = { tile, by: seat };
    this.selfCanHu = false;
    // 抢金窗口：庄家开金后必须先打掉一张多余的牌（天胡则直接胡、没有这一手），
    //   这一手打完，闲家才能拿**开局翻出的那张公示金**抢金 —— 抢的不是庄家打出的牌。
    const openingDiscard = this.opening && seat === this.dealer;
    this.opening = false;
    this.log.push(`${p.name} 打出 ${MJ.TILE_NAMES[tile]}`);
    this.emit({ ev: 'discard', seat, tile });
    this.openClaims(seat, tile, openingDiscard);
    return { ok: true };
  }

  openClaims(bySeat, tile, openingDiscard = false) {
    // 抢金窗口 = 庄家开金后的第一手打牌之后。抢的是公示金（this.joker），与打出的这张无关：
    //   庄家打的是 5 万，闲家照样可以用"翻出来的那张金"胡。
    const qiangjin = !!openingDiscard;
    const seats = [];
    for (const p of this.players) {
      // 抢金窗口里，打牌的庄家自己也能抢（手牌同样 16 张），但优先级最低；
      //   除此之外，谁都不能响应自己打出的牌（不能吃/碰/杠自己的弃牌）。
      if (p.seat === bySeat) {
        if (qiangjin && this.canQiangjin(p)) seats.push({ seat: p.seat, acts: ['hu'] });
        continue;
      }
      const acts = this.availableClaims(p, tile, bySeat, qiangjin);
      if (acts.length > 0) seats.push({ seat: p.seat, acts });
    }
    if (seats.length === 0) { this.nextTurn(); return; }
    this.pending = {
      by: bySeat, tile, qiangjin, seats: seats.map((s) => s.seat), acts: seats,
      responded: new Set(), huList: [], claimed: false,
      // 抢金窗口里真正能抢金的家：吃/碰/杠必须等这几家全部明确"过"了才生效
      qjSeats: qiangjin ? seats.filter((x) => x.acts.includes('hu') && this.canQiangjin(this.getPlayer(x.seat)))
        .map((x) => x.seat) : [],
      // 小胡提示只对"点炮这张牌"成立；能抢金的玩家不算小胡（抢金本身是大牌）
      xiaoHu: seats.filter((x) => {
        const pl = this.getPlayer(x.seat);
        if (qiangjin && this.canQiangjin(pl)) return false;
        return this.isXiaoHuOnly(pl, tile, false);
      }).map((x) => x.seat),
    };
    this.armPendingTimeout();
    this.broadcast();
  }

  // 响应超时兜底：30 秒不表态自动"过"，避免掉线/发呆把整局卡死
  armPendingTimeout() {
    if (this._pendTimer) clearTimeout(this._pendTimer);
    const pend = this.pending;
    if (!pend) return;
    this._pendTimer = setTimeout(() => {
      if (this.pending !== pend) return;
      let changed = false;
      for (const sd of pend.seats) {
        if (pend.responded.has(sd)) continue;
        const pl = this.getPlayer(sd);
        if (!pl || pl.isBot) continue;
        pend.responded.add(sd);
        this.log.push(`${pl.name} 超时未响应，自动过`);
        changed = true;
      }
      if (!changed) return;
      if (pend.responded.size >= pend.seats.length) this.finishClaims();
      else this.broadcast();
    }, PENDING_TIMEOUT_MS);
    if (this._pendTimer.unref) this._pendTimer.unref();
  }

  availableClaims(p, tile, bySeat, qiangjinIn) {
    const acts = [];
    if (this.jinKanActive) return acts; // 金坎生效：全场只能自摸，无人可点炮
    const isJoker = tile === this.joker;
    // 抢金：开局庄家首打之后的窗口里，闲家可以拿**公示金**（不是这张弃牌）加进手牌胡。
    //   金本身不能点炮，所以打出的若是金，只可能靠抢金胡。
    const qiangjin = !!qiangjinIn && this.canQiangjin(p);
    // 点炮胡先判：5 组副露的大单调只剩一张等将，正是最该能胡的时候，
    //   不能被"副露满了"这条挡住（那条只限制吃/碰/杠）。
    if (qiangjin || (!isJoker && this.canRon(p, tile, false))) acts.push('hu');
    // 手牌 16 张制：最多 5 个副露，满了就只等将，不能再吃碰杠
    if (p.melds.length >= 5) return acts;
    if (!isJoker && !p.jinKan && p.seat === (bySeat + 1) % this.players.length) {
      const combos = this.chiCombos(p.hand, tile, this.joker);
      if (combos.length > 0) acts.push({ act: 'chi', combos });
    }
    if (!isJoker && !p.jinKan) {
      const cnt = p.hand.filter((t) => t === tile).length;
      if (cnt >= 2) acts.push('peng');
      if (cnt >= 3 && this.wall.length > 0) acts.push('gang'); // 墙空不能杠（补不出牌）
    }
    return acts;
  }

  // 抢金资格：把**开局翻出的那张公示金**加进 16 张手牌能成 17 张胡牌型。
  //   与庄家打出的那张牌无关。3 金时允许拆开当赖子（qiangjin 口径）。
  //   庄家也能抢：开局摸完先打掉一张（天胡则直接胡，没有这一手），手牌同样剩 16 张，
  //   拿公示金一样能成牌；只是优先级最低 —— 按逆时针轮完闲家才轮到庄家。
  canQiangjin(p) {
    if (this.jinKanActive || p.jinKan) return false;
    if (this.joker < 0) return false;
    // 庄家必须先打掉首张（手牌从 17 张变 16 张）才有抢金资格
    if (p.seat === this.dealer && p.discards.length === 0) return false;
    if (this.fullTiles(p).length !== 16) return false;
    return this.checkWinOf(p, [this.joker], { qiangjin: true }).win;
  }

  // 点炮胡资格：大牌可点炮，小胡（普通标准型）只能自摸
  // 金雀 / 金坎 必须自摸；三金倒、清一色、混一色、对对胡、金龙、无花胡、大单调可点炮
  //   大单调 = 5 组副露 + 手上只剩 1 张（这张就是要钓的将）；手上剩 4 张的单钓将不算。
  //   无金的大单调可以点炮；剩金的大单调本身没有别的牌型奖励 → 只能自摸，叠了大牌照样点炮。
  canRon(p, tile, qiangjin) {
    if (this.jinKanActive || p.jinKan) return false;
    const full = this.fullTiles(p).concat([tile]);
    if (full.length !== 17) return false; // 张数不对（少了/多了）一律不判胡
    // 抢金时 3 金允许拆成赖子，不走三金倒 → 口径要一起传下去
    // 三金倒只能自己回合摸到第 3 张金倒，点炮不存在三金倒 → sanjindao:false
    const r = this.checkWinOf(p, [tile], { qiangjin, sanjindao: false });
    if (!r.win) return false;
    const f = r.feats || {};
    if (qiangjin) return true; // 抢金本身是大牌，任何牌型都能抢
    const big = !!(f.hunyise || f.qingyise || f.youjinDuizi || f.wujinDuizi || f.jinlong);
    // 单纯金雀必须自摸；但"双金作将 + 全都是碰/刻"同时也是有金对对胡（可点炮），
    //   不能因为带了金雀标签就一刀切封杀（截图那手：4 碰 + 金金将 + 777 条）。
    if (f.jinque && !big) return false;
    if (p.flowerCount === 0) return true; // 无花胡是大牌
    // 大单调：5 组副露 + 手上只剩 1 张（胡牌张就是它的对子）
    //   无金 → 是明确的大牌（12 片），可以点炮；
    //   剩金 → 摸什么都能胡，本身没有牌型奖励，只能自摸；叠了清/混/对对胡照样可以点炮。
    const danDiao = p.melds.length === 5 && p.hand.length === 1;
    if (danDiao) return !p.hand.includes(this.joker) || big;
    return big;
  }

  // 这手牌若别人打出能凑成胡、但只是小胡（不能点炮）→ 用于前端提示
  isXiaoHuOnly(p, tile, qiangjin) {
    if (this.jinKanActive || p.jinKan) return false;
    if (this.canRon(p, tile, qiangjin)) return false;
    const full = this.fullTiles(p).concat([tile]);
    if (full.length !== 17) return false;
    return this.checkWinOf(p, [tile], { qiangjin, sanjindao: false }).win;
  }

  // 金雀听牌：手里正好 2 金，等哪几张牌能让"双金作将"成立
  jinQueWaitTiles(p) {
    if (p.jinKan || this.jinKanActive) return [];
    if (p.hand.length % 3 !== 1) return [];
    if (p.hand.filter((t) => t === this.joker).length !== 2) return [];
    const out = [];
    for (let t = 0; t < MJ.NUMERAL; t++) {
      if (t === this.joker) continue;
      if (p.hand.filter((x) => x === t).length >= 4) continue;
      const r = this.checkWinOf(p, [t]);
      if (r.win && r.feats && r.feats.jinque) out.push(t);
    }
    return out;
  }

  chiCombos(hand, tile, joker) {
    if (tile >= 27) return []; // 花/字牌不可吃
    if (tile === joker) return []; // 金不能吃
    const r = MJ.rankOf(tile);
    const base = Math.floor(tile / 9) * 9;
    const tOf = (rank) => base + rank - 1;
    // 关键：rank 必须留在 1-9 内，否则会跨花色（如 九万+1 变成一条）
    // 关键2：金不能进吃牌组合（金只当赖子留在手里）
    const has = (rank) => rank >= 1 && rank <= 9 && hand.includes(tOf(rank)) && tOf(rank) !== joker;
    const combos = [];
    if (has(r - 1) && has(r + 1)) combos.push([tOf(r - 1), tOf(r + 1)]);
    if (has(r - 2) && has(r - 1)) combos.push([tOf(r - 2), tOf(r - 1)]);
    if (has(r + 1) && has(r + 2)) combos.push([tOf(r + 1), tOf(r + 2)]);
    return combos;
  }

  nextTurn() {
    this.turn = (this.turn + 1) % this.players.length;
    this.pending = null;
    this.drawCurrent();
  }

  // ---------- 响应 ----------
  // 还有哪些"优先级更高"的家没表态：
  //   includePeng=false → 只看能胡的（碰/杠要等胡）
  //   includePeng=true  → 看能胡的 + 能碰/杠的（吃要等胡和碰杠）
  // 同级的其他碰家不算"更高"，先点先得，不必互相等。
  higherWaiters(pend, seat, includePeng) {
    const out = [];
    for (const sd of pend.seats) {
      if (sd === seat || pend.responded.has(sd)) continue;
      const entry = (pend.acts || []).find((a) => a.seat === sd);
      const acts = (entry && entry.acts) || [];
      if (acts.includes('hu')) { out.push(sd); continue; }
      if (includePeng && acts.some((x) => x === 'peng' || x === 'gang')) out.push(sd);
    }
    return out;
  }

  // 抢金窗口专属：还有哪些"能抢金"的家没表态。
  //   抢金是大牌且只在开局这一手存在 → 吃/碰/杠必须等这几家全部点过才允许生效，
  //   不跟"谁先点"抢，也不因为自己是碰家就插队。
  qjWaiters(pend, exceptSeat) {
    if (!pend || !pend.qiangjin || pend.kind === 'qianggang') return [];
    return (pend.qjSeats || []).filter((sd) => sd !== exceptSeat && !pend.responded.has(sd));
  }

  claim(seat, action, payload) {
    if (!this.pending) return { ok: false, msg: '当前无可响应操作' };
    const pend = this.pending;
    if (!pend.seats.includes(seat)) return { ok: false, msg: '你无需响应' };
    if (pend.responded.has(seat)) return { ok: false, msg: '已响应' };
    // 抢杠窗口只有"胡 / 过"两种回应（牌在杠家手里，不存在吃碰杠）
    if (pend.kind === 'qianggang' && action !== 'hu' && action !== 'pass') {
      return { ok: false, msg: '抢杠只能选择胡或过' };
    }

    if (action === 'pass') { pend.responded.add(seat); }
    else if (action === 'hu') {
      const pc = this.getPlayer(seat);
      // 抢金窗口里，闲家拿公示金能成牌就一定能胡（抢金本身是大牌），
      //   要和 availableClaims 用同一口径，否则按钮亮了、点了却被判"小胡只能自摸"。
      const qj = !!pend.qiangjin && pend.kind !== 'qianggang' && this.canQiangjin(pc);
      if (!qj && !this.canRon(pc, pend.tile, false)) {
        pend.responded.add(seat);
        this.log.push(`${pc.name} 这手是小胡，只能自摸，不能点炮`);
      } else {
        pend.huList.push(seat); pend.responded.add(seat);
      }
    }
    else if (action === 'chi') {
      // 吃是最低优先级：胡 > 碰/杠 > 吃。只要有更高优先级的家还没表态，就先把吃挂起，
      //   等他们全部明确"过"了才真正吃；有人胡/碰则吃作废。
      if (pend.huList.length > 0 || pend.pengIntent || pend.tile === this.joker) {
        pend.responded.add(seat);
      } else if (this.qjWaiters(pend, seat).length > 0) {
        // 抢金窗口：能抢金的家还没表态，吃先挂着
        const names = this.qjWaiters(pend, seat).map((sd) => this.getPlayer(sd).name).join('、');
        pend.chiIntent = { seat, combo: payload && payload.combo };
        pend.responded.add(seat);
        this.log.push(`${this.getPlayer(seat).name} 想吃 ${MJ.TILE_NAMES[pend.tile]}，等 ${names} 先决定抢不抢金（抢金优先）`);
      } else {
        const waitHigher = this.higherWaiters(pend, seat, true);
        if (waitHigher.length > 0) {
          pend.chiIntent = { seat, combo: payload && payload.combo };
          pend.responded.add(seat);
          const names = waitHigher.map((sd) => this.getPlayer(sd).name).join('、');
          this.log.push(`${this.getPlayer(seat).name} 想吃 ${MJ.TILE_NAMES[pend.tile]}，等 ${names} 先决定胡不胡/碰不碰`);
        } else {
          const r = this.doChi(seat, pend.tile, pend.by, payload && payload.combo);
          if (!(r && r.ok === false)) return r || { ok: true };
          pend.responded.add(seat);
        }
      }
    }
    else if (action === 'peng' || action === 'gang') {
      if (pend.huList.length > 0 || pend.pengIntent) {
        pend.responded.add(seat);
      } else if (this.qjWaiters(pend, seat).length > 0) {
        // 抢金窗口：先挂起，等能抢金的家都点过才成立
        const names = this.qjWaiters(pend, seat).map((sd) => this.getPlayer(sd).name).join('、');
        pend.pengIntent = { seat, action, tile: pend.tile };
        pend.responded.add(seat);
        this.log.push(`${this.getPlayer(seat).name} 想${action === 'peng' ? '碰' : '杠'} ${MJ.TILE_NAMES[pend.tile]}，等 ${names} 先决定抢不抢金（抢金优先）`);
      } else {
        // 胡 > 碰/杠：能点炮胡的家还没表态时，碰/杠先挂起。
        //   哪怕自己先点了碰，只要有人随后喊胡，碰就作废（这是牌桌常识，也是这次要修的地方）。
        const waitHu = this.higherWaiters(pend, seat, false);
        if (waitHu.length > 0) {
          pend.pengIntent = { seat, action, tile: pend.tile };
          pend.responded.add(seat);
          const names = waitHu.map((sd) => this.getPlayer(sd).name).join('、');
          this.log.push(`${this.getPlayer(seat).name} 想${action === 'peng' ? '碰' : '杠'} ${MJ.TILE_NAMES[pend.tile]}，等 ${names} 先决定胡不胡（胡优先）`);
        } else {
          if (pend.chiIntent) {
            this.log.push(`碰优先：${this.getPlayer(pend.chiIntent.seat).name} 的吃被取消`);
            pend.chiIntent = null;
          }
          const r = action === 'peng' ? this.doPeng(seat, pend.tile, pend.by) : this.doGang(seat, pend.tile, pend.by);
          if (r && r.ok === false) pend.responded.add(seat);
          else return r || { ok: true };
        }
      }
    }

    if (pend.responded.size >= pend.seats.length) this.finishClaims();
    else this.broadcast();
    return { ok: true };
  }

  finishClaims() {
    const pend = this.pending;
    if (!pend) return;
    // 抢杠窗口：有人抢 → 杠作废（副露仍是碰），第 4 张归胡家；无人抢 → 杠照常成立
    if (pend.kind === 'qianggang') {
      this.pending = null;
      if (pend.huList.length > 0) {
        const giver = this.getPlayer(pend.by);
        const gi = giver.hand.lastIndexOf(pend.tile);
        if (gi >= 0) giver.hand.splice(gi, 1);
        giver.hand = sortHand(giver.hand, this.joker);
        const winnerSeat = this.resolveMultipleHu(pend.huList, pend.by, false);
        this.doHu(winnerSeat, false, pend.by, { qianggang: true, tile: pend.tile });
      } else {
        const k = pend.kong || {};
        const r = this.applyBuGang(k.seat, k.tile, k.mi);
        if (!r || r.ok === false) this.broadcast();
      }
      return;
    }
    const qjWindow = !!pend.qiangjin;
    if (this.opening) this.opening = false; // 有人响应庄家首张 → 抢金窗口到此为止
    // ① 胡最大：只要有人喊胡，吃碰杠全部作废（哪怕碰家先点了）
    if (pend.huList.length > 0) {
      const winnerSeat = this.resolveMultipleHu(pend.huList, pend.by, qjWindow);
      // 抢金只认"把公示金加进来能胡"的那家；胡牌张就是公示金，不是庄家打出的弃牌
      const winnerQj = qjWindow && this.canQiangjin(this.getPlayer(winnerSeat));
      this.doHu(winnerSeat, false, pend.by, winnerQj ? { qiangjin: true, tile: this.joker } : {});
      return;
    }
    // ② 没人胡（都明确过了）→ 才轮到碰/杠
    if (pend.pengIntent) {
      const it = pend.pengIntent;
      if (qjWindow && (pend.qjSeats || []).length) {
        const who = pend.qjSeats.map((sd) => this.getPlayer(sd).name).join('、');
        this.log.push(`${who} 放弃抢金 → ${this.getPlayer(it.seat).name} 的${it.action === 'gang' ? '杠' : '碰'}现在生效`);
      }
      this.pending = null;
      // doPeng/doGang 成功时返回 undefined（内部已广播），失败才返回 {ok:false}
      const r = it.action === 'gang'
        ? this.doGang(it.seat, pend.tile, pend.by)
        : this.doPeng(it.seat, pend.tile, pend.by);
      if (r && r.ok === false) this.nextTurn();
      return;
    }
    // ③ 碰/杠也没有 → 最后才是吃
    if (pend.chiIntent) {
      if (qjWindow && (pend.qjSeats || []).length) {
        const who = pend.qjSeats.map((sd) => this.getPlayer(sd).name).join('、');
        this.log.push(`${who} 放弃抢金 → ${this.getPlayer(pend.chiIntent.seat).name} 的吃现在生效`);
      }
      this.pending = null;
      const r = this.doChi(pend.chiIntent.seat, pend.tile, pend.by, pend.chiIntent.combo);
      if (!r || r.ok === false) this.nextTurn();
      return;
    }
    this.nextTurn();
  }

  recordEatPong(p, fromSeat) {
    p.eatPongCount++;
    if (fromSeat >= 0) p.providers.push(fromSeat);
  }

  doPeng(seat, tile, fromSeat) {
    const p = this.getPlayer(seat);
    if (p.melds.length >= 5) return { ok: false, msg: '副露已满 5 组' };
    let removed = 0;
    for (let i = p.hand.length - 1; i >= 0 && removed < 2; i--) {
      if (p.hand[i] === tile) { p.hand.splice(i, 1); removed++; }
    }
    const fp = this.getPlayer(fromSeat);
    const di = fp.discards.lastIndexOf(tile);
    if (di >= 0) fp.discards.splice(di, 1);
    p.melds.push({ type: 'peng', tiles: [tile, tile, tile], from: fromSeat });
    p.hand = sortHand(p.hand, this.joker);
    p.lastDrawn = -1; // 碰完不再有"刚摸的那张"
    this.recordEatPong(p, fromSeat);
    this.turn = seat; this.lastDiscard = null;
    this.log.push(`${p.name} 碰 ${MJ.TILE_NAMES[tile]}`);
    this.emit({ ev: 'peng', seat, tile });
    this.pending = null; this.broadcast();
  }

  doChi(seat, tile, fromSeat, combo) {
    const p = this.getPlayer(seat);
    if (p.melds.length >= 5) return { ok: false, msg: '副露已满 5 组' };
    // 严格校验：必须是同花色、能与打出的牌组成连续顺子（防止错配/跨花色吃）
    const valid = (arr) => {
      if (!Array.isArray(arr) || arr.length !== 2) return false;
      if (arr.some((t) => typeof t !== 'number' || t >= 27 || MJ.suitOf(t) !== MJ.suitOf(tile))) return false;
      if (arr.some((t) => Math.floor(t / 9) !== Math.floor(tile / 9))) return false; // 同花色段
      if (arr.some((t) => t === this.joker)) return false; // 金不能拿去吃
      const three = [...arr, tile].sort((a, b) => a - b);
      return three[1] - three[0] === 1 && three[2] - three[1] === 1;
    };
    let useCombo = valid(combo) ? combo.slice() : null;
    if (!useCombo) {
      const combos = this.chiCombos(p.hand, tile, this.joker);
      if (combos.length === 0) return { ok: false, msg: '无法吃' };
      useCombo = combos[0];
    }
    // 先校验手牌齐全，再删除（避免中途失败吞牌）
    const handCopy = [...p.hand];
    for (const c of useCombo) {
      const idx = handCopy.indexOf(c);
      if (idx < 0) return { ok: false, msg: '手牌不足' };
      handCopy.splice(idx, 1);
    }
    p.hand = handCopy;
    const fp = this.getPlayer(fromSeat);
    const di = fp.discards.lastIndexOf(tile);
    if (di >= 0) fp.discards.splice(di, 1);
    p.melds.push({ type: 'chi', tiles: [...useCombo, tile].sort((a, b) => a - b), from: fromSeat });
    p.hand = sortHand(p.hand, this.joker);
    p.lastDrawn = -1; // 吃完不再有"刚摸的那张"
    this.recordEatPong(p, fromSeat);
    this.turn = seat; this.lastDiscard = null;
    this.log.push(`${p.name} 吃 ${MJ.TILE_NAMES[tile]}`);
    this.emit({ ev: 'chi', seat, tile });
    this.pending = null; this.broadcast();
    return { ok: true };
  }

  doGang(seat, tile, fromSeat) {
    const p = this.getPlayer(seat);
    if (p.melds.length >= 5) return { ok: false, msg: '副露已满 5 组' };
    // 杠要补一张牌，牌墙已空不能杠（否则补不出牌，手牌会少一张）
    if (this.wall.length === 0) return { ok: false, msg: '牌墙已空，不能杠' };
    let removed = 0;
    for (let i = p.hand.length - 1; i >= 0 && removed < 3; i--) {
      if (p.hand[i] === tile) { p.hand.splice(i, 1); removed++; }
    }
    const fp = this.getPlayer(fromSeat);
    const di = fp.discards.lastIndexOf(tile);
    if (di >= 0) fp.discards.splice(di, 1);
    p.melds.push({ type: 'gang', tiles: [tile, tile, tile, tile], from: fromSeat });
    p.hand = sortHand(p.hand, this.joker);
    this.recordEatPong(p, fromSeat);
    this.turn = seat; this.lastDiscard = null; this.pending = null;
    this.log.push(`${p.name} 杠 ${MJ.TILE_NAMES[tile]}`);
    this.emit({ ev: 'gang', seat, tile });
    this.drawReplacement(p);
    this.selfCanHu = this.checkWinOf(p).win;
    this.broadcast();
  }

  // 杠后补牌：摸到花继续补，直到摸到数牌（与正常摸牌的补花一致）
  drawReplacement(p) {
    p.lastDrawn = -1; // 补牌前先清空，摸到花继续补时以最后一张数牌为准
    while (this.wall.length > 0) {
      const t = this.wall.pop();
      if (MJ.isFlower(t)) { p.flowerCount++; continue; }
      p.hand.push(t);
      p.hand = sortHand(p.hand, this.joker);
      p.lastDrawn = t; // 杠上开花时"最后胡的那张"要显示这一张
      return t;
    }
    return -1;
  }

  anGang(seat, tile) {
    if (seat !== this.turn || this.pending) return { ok: false, msg: '当前不可暗杠' };
    const p = this.getPlayer(seat);
    if (p.melds.length >= 5) return { ok: false, msg: '副露已满 5 组' };
    const cnt = p.hand.filter((t) => t === tile).length;
    if (cnt < 4) return { ok: false, msg: '手里不足4张' };
    if (tile === this.joker) return { ok: false, msg: '金不可暗杠' };
    if (this.wall.length === 0) return { ok: false, msg: '牌墙已空，不能杠' };
    for (let i = p.hand.length - 1; i >= 0 && cnt; i--) if (p.hand[i] === tile) p.hand.splice(i, 1);
    p.melds.push({ type: 'angang', tiles: [tile, tile, tile, tile] });
    p.hand = sortHand(p.hand, this.joker);
    this.recordEatPong(p, -1); // 暗杠算一手（包牌手数），无外部喂牌
    this.log.push(`${p.name} 暗杠`);
    this.emit({ ev: 'angang', seat });
    this.drawReplacement(p);
    this.selfCanHu = this.checkWinOf(p).win;
    this.broadcast();
    return { ok: true };
  }

  // 加杠（补杠）：碰过的牌，手里还留着第 4 张 → 自己回合随时可以补杠
  //   - 碰完当场可以杠（仍是自己回合，手上 3n+2 张）
  //   - 之后每一轮摸牌都能再选：只要手里还留着那张牌没被用掉（打掉 / 拿去吃碰都不行）
  //   - 杠完补摸一张，可杠上开花
  //   - 别人若能用这张牌凑成"有奖励的大牌"，可以先抢杠胡（抢杠优先，杠不成立）
  buGang(seat, tile) {
    if (seat !== this.turn || this.pending) return { ok: false, msg: '当前不可加杠' };
    const p = this.getPlayer(seat);
    if (!p) return { ok: false, msg: '无效' };
    if (p.jinKan) return { ok: false, msg: '金坎后不能杠' };
    if (this.jinKanActive) return { ok: false, msg: '金坎生效中，全场不能杠' };
    if (typeof tile !== 'number' || tile === this.joker) return { ok: false, msg: '金不能杠' };
    const mi = p.melds.findIndex((m) => m.type === 'peng' && m.tiles.length === 3 && m.tiles[0] === tile);
    if (mi < 0) return { ok: false, msg: '没有碰过这张，不能加杠' };
    const hi = p.hand.lastIndexOf(tile);
    if (hi < 0) return { ok: false, msg: '手里没有第 4 张' };
    if (p.hand.length % 3 !== 2) return { ok: false, msg: '摸牌后才能加杠' };

    // 抢杠：有人的手牌 + 这张能凑成"有奖励的大牌" → 先让别人抢，杠暂缓成立
    const robSeats = this.robKongSeats(seat, tile);
    if (robSeats.length > 0) {
      const names = robSeats.map((sd) => this.getPlayer(sd).name).join('、');
      this.pending = {
        by: seat, tile, kind: 'qianggang', seats: robSeats,
        acts: robSeats.map((sd) => ({ seat: sd, acts: ['hu'] })),
        responded: new Set(), huList: [], claimed: false,
        kong: { seat, tile, mi },
      };
      this.log.push(`${p.name} 加杠 ${MJ.TILE_NAMES[tile]} → ${names} 可抢杠胡（等其决定）`);
      this.armPendingTimeout();
      this.broadcast();
      return { ok: true, msg: '开抢杠窗口' };
    }
    return this.applyBuGang(seat, tile, mi);
  }

  // 无人抢杠 → 杠真正成立：碰升成明杠 + 补摸一张（可杠上开花）
  applyBuGang(seat, tile, mi) {
    const p = this.getPlayer(seat);
    const hi = p.hand.lastIndexOf(tile);
    if (hi < 0) return { ok: false, msg: '手里没有第 4 张' };
    if (p.hand.length % 3 !== 2) return { ok: false, msg: '手牌数异常，不能加杠' };
    if (this.wall.length === 0) return { ok: false, msg: '牌墙已空，不能加杠' };
    p.hand.splice(hi, 1);
    p.melds[mi] = { type: 'gang', tiles: [tile, tile, tile, tile], from: p.melds[mi].from, bugang: true };
    p.hand = sortHand(p.hand, this.joker);
    this.log.push(`${p.name} 加杠 ${MJ.TILE_NAMES[tile]}`);
    this.emit({ ev: 'bugang', seat, tile });
    this.pending = null;
    // 补摸一张（花直接补花）
    this.drawReplacement(p);
    this.selfCanHu = this.checkWinOf(p).win;
    this.broadcast();
    return { ok: true };
  }

  // 谁能抢杠：手牌 + 这张牌能凑成"有奖励的大牌"
  //   小胡不能抢杠（与"小胡不能点炮"同一口径）；金坎生效中全场不能点炮，也就不能抢杠
  robKongSeats(seat, tile) {
    const out = [];
    if (this.jinKanActive) return out;
    if (typeof tile !== 'number' || tile === this.joker) return out;
    for (const other of this.players) {
      if (other.seat === seat) continue;
      if (other.melds.length >= 5) continue;
      if (this.canRon(other, tile, false)) out.push(other.seat);
    }
    return out;
  }

  // 是否在做清/混一色（只有这两类包牌才需要宣告听牌；对对胡等不必宣告）
  // 摸牌后（3n+2）允许手里有 1 张杂色：那一张本来就是该打掉的，不能因此把"报听"按钮藏起来。
  //   但必须确认"打掉那张之后真的听牌"，否则会误给按钮。
  isQingHunShape(p) {
    const cnt = { m: 0, s: 0, p: 0 };
    const full = this.fullTiles(p);
    for (const t of full) {
      if (t >= 27 || t === this.joker) continue;
      cnt[MJ.suitOf(t)]++;
    }
    const used = [cnt.m, cnt.s, cnt.p].filter((n) => n > 0).sort((a, b) => b - a);
    if (used.length <= 1) return true;
    if (!(used.length === 2 && used[1] === 1 && p.hand.length % 3 === 2)) return false;
    // 找那张唯一的杂色，打掉它再看是否听牌（全手同一门）
    const minor = ['m', 's', 'p'].find((s) => cnt[s] === 1);
    const t = p.hand.find((x) => x < 27 && x !== this.joker && MJ.suitOf(x) === minor);
    if (t == null) return false;
    const hand = p.hand.slice();
    hand.splice(hand.indexOf(t), 1);
    return MJ.isTingEx(hand, p.melds, this.joker);
  }

  // 听牌宣告（清/混一色 + 吃碰≥3 手 需宣告）
  declareTing(seat) {
    const p = this.getPlayer(seat);
    if (!p) return { ok: false };
    p.declaredTing = true;
    this.log.push(`${p.name} 宣告听牌`);
    this.emit({ ev: 'ting', seat });
    this.broadcast();
    return { ok: true };
  }

  // 金坎宣告：用金补"坎"（如 79筒 + 金当 8筒）→ 亮出这两张、中间留金位；
  //   宣告后该家手牌全部盖倒：不吃不碰不杠，只能摸牌，摸到非金必须原样打掉，摸到金即胡。
  // 时机：自己回合、手里 0 金、能听"卡金"。摸牌后/吃碰后（3n+2）会自动把多余那张打掉再宣告；
  //   已经是听牌形态（3n+1）则直接宣告。
  declareJinKan(seat) {
    const p = this.getPlayer(seat);
    if (!p) return { ok: false, msg: '无效' };
    if (this.turn !== seat) return { ok: false, msg: '仅自己回合可宣告金坎' };
    if (this.pending) return { ok: false, msg: '请先处理吃碰杠胡' };
    if (p.jinKan) return { ok: false, msg: '已宣告金坎' };
    if (p.melds.length >= 5) return { ok: false, msg: '副露已满 5 组，不能再做金坎' };
    if (p.hand.includes(this.joker)) return { ok: false, msg: '手里已有金，不能宣告金坎' };
    const slots = this.jinKanSlots();
    if (!slots) return { ok: false, msg: '金是边张（1/9），没有"坎"可做' };
    const lo = slots[0], hi = slots[2];
    // 必须手里实有金的前后两张（不能从副露里拆）
    if (!p.hand.includes(lo) || !p.hand.includes(hi)) {
      return { ok: false, msg: `需要手里有 ${MJ.TILE_NAMES[lo]}+${MJ.TILE_NAMES[hi]} 卡 ${MJ.TILE_NAMES[this.joker]}` };
    }

    const rem = p.hand.length % 3;
    let extraTile = null;
    if (rem === 2) {
      // 摸牌后 / 吃碰后：手上多一张，先打掉多余的那张，回到卡金听的形态
      //   绝不能打 lo / hi 本身（那是金坎要亮出来的两张）
      extraTile = this.findKanDiscard(p, [lo, hi]);
      if (extraTile == null) return { ok: false, msg: '打掉一张后也不是卡金听牌，不能宣告' };
      p.hand.splice(p.hand.indexOf(extraTile), 1);
      if (!MJ.isJinKanWait(p.hand, this.joker)) {
        p.hand.push(extraTile); // 回滚
        p.hand = sortHand(p.hand, this.joker);
        return { ok: false, msg: '打掉一张后也不是卡金听牌，不能宣告' };
      }
      p.discards.push(extraTile);
      this.log.push(`${p.name} 打出 ${MJ.TILE_NAMES[extraTile]}`);
    } else if (rem === 1) {
      if (!MJ.isJinKanWait(p.hand, this.joker)) {
        return { ok: false, msg: '当前不是卡金听牌，不能宣告' };
      }
    } else {
      return { ok: false, msg: '手牌数异常，无法宣告金坎' };
    }

    // 亮出这组坎：金的前一张 + 金位 + 金的后一张（如 七筒 [金] 九筒）
    //   先确认两张都在手里再动状态，避免亮到一半留下脏数据
    for (const x of [lo, hi]) {
      if (!p.hand.includes(x)) return { ok: false, msg: '金坎亮牌失败（手牌里找不到要亮的牌）' };
    }
    for (const x of [lo, hi]) p.hand.splice(p.hand.indexOf(x), 1);
    p.jinKan = true;
    this.jinKanActive = true;
    p.melds.push({ type: 'jinkan', tiles: slots.slice(), from: -1 });
    p.hand = sortHand(p.hand, this.joker);
    const showTxt = `亮出 ${MJ.TILE_NAMES[lo]} 〔金位〕 ${MJ.TILE_NAMES[hi]}`;
    this.log.push(`${p.name} 宣告金坎（${showTxt}），手牌全部盖倒：不吃不碰不杠，只摸金自摸`);
    this.emit({ ev: 'jinkan', seat });
    this.lastDiscard = null;
    this.nextTurn();
    return { ok: true };
  }

  // 是否满足金坎宣告条件（前端按钮用）
  canJinKan(p) {
    if (!p || p.jinKan) return false;
    if (this.joker < 0 || this.joker >= 27) return false;
    if (p.hand.includes(this.joker)) return false;
    if (p.melds.length >= 5) return false;
    const slots = this.jinKanSlots();
    if (!slots) return false;
    if (!p.hand.includes(slots[0]) || !p.hand.includes(slots[2])) return false;
    const rem = p.hand.length % 3;
    if (rem === 2) return this.findKanDiscard(p, [slots[0], slots[2]]) != null;
    if (rem === 1) return MJ.isJinKanWait(p.hand, this.joker);
    return false;
  }

  // 摸牌后打哪张能进入"卡金听牌"（用于金坎宣告）
  //   keep：金坎要亮出来的那两张，打完必须都还在手里（重复的张可以打掉一张）
  findKanDiscard(p, keep = []) {
    const cand = [...new Set(p.hand)].filter((t) => t !== this.joker).sort((a, b) => a - b);
    for (const t of cand) {
      const h = p.hand.slice();
      const i = h.indexOf(t);
      if (i < 0) continue;
      h.splice(i, 1);
      if (!keep.every((k) => h.includes(k))) continue; // 不能把要亮的牌打光
      if (MJ.isJinKanWait(h, this.joker)) return t;
    }
    return null;
  }

  // 金坎亮牌槽位（固定为「金前一张 · 金位 · 金后一张」）
  jinKanSlots() {
    const j = this.joker;
    if (!(j >= 0 && j < 27)) return null;
    const r = (j % 9) + 1;
    if (r <= 1 || r >= 9) return null;
    return [j - 1, 'J', j + 1];
  }

  // 金坎能不能胡：必须真摸到金，且把"lo + 金 + hi"这一组固定扣掉后，
  //   剩下 14 张自己凑成 4 面子 + 将（不走"金当百搭"的宽松口径，
  //   否则亮的 lo/hi 会被别的顺子借走，看着成立其实金位没用上）。
  jinKanWin(p) {
    if (!p || !p.jinKan) return false;
    if (!p.hand.includes(this.joker)) return false;
    // 只看暗牌：金的坎位已经亮在副露里，不能再把碰/吃的牌倒回来凑
    const hand = p.hand.filter((t) => t !== this.joker);
    const other = p.melds.filter((m) => m.type !== 'jinkan').length; // 金坎本身 = 1 个面子
    const need = 4 - other;
    if (need < 0) return false;
    const { counts, jokers } = MJ.separateJokers(hand, this.joker);
    if (jokers !== 0) return false;
    return !!MJ.decomposeNeed(counts, 0, need);
  }

  // 找出"由金补位"的顺子槽位（保留兼容）
  findJinKanShun(p) { return this.jinKanSlots(); }

  // ---------- 胡 ----------
  doHu(seat, zimo, fromSeat, extra = {}) {
    const p = this.getPlayer(seat);
    // 胡的那张：抢杠=杠家手里被抢的那张；抢金=开局翻出的公示金；自摸=刚摸到的那张；点炮=最后一张弃牌
    const winTile = extra.tile != null ? extra.tile
      : extra.qiangjin ? this.joker
        : zimo ? (p.lastDrawn >= 0 ? p.lastDrawn : (p.hand[p.hand.length - 1] || 0))
          : (this.lastDiscard ? this.lastDiscard.tile : 0);
    // 硬校验：大乱斗 16 张制，胡牌必定是 5 组面子 + 1 将 = 17 张，少一张/多一张都不算胡
    if (this.fullTiles(p).length + (zimo ? 0 : 1) !== 17) return { ok: false, msg: '手牌张数不对，不能胡' };
    // 抢金 = 只在开局：庄家开金后先打掉一张多余的牌，闲家把**翻出来的公示金**拿进手牌胡。
    //   抢的不是庄家打出的那张；自摸摸到金也不算抢金（那只是普通自摸/金雀/三金倒）。
    // 天胡候选：庄家开金后的第一手（还没人打过牌）摸完就成牌
    const tianhuCand = zimo && this.isTianHu(seat);
    const qiangjin = !!extra.qiangjin;
    let r;
    if (p.jinKan) {
      // 金坎：坎位三张已经亮在副露里，只看暗牌（含刚摸到的金）能不能凑成 4 面子 + 将
      if (!this.jinKanWin(p)) return { ok: false, msg: '金坎要摸到金、且牌型成立才能胡' };
      r = MJ.checkWinEx(p.hand.filter((t) => t !== this.joker), p.melds, this.joker);
    } else {
      // 抢金：手里 2 金 + 抢进第 3 金时，三张金可拆开当赖子 → 按真实牌型判定
      // 三金倒只能自摸：点炮/抢杠时关掉三金倒，手牌必须真的成型
      r = this.checkWinOf(p, zimo ? [] : [winTile], { qiangjin, sanjindao: zimo });
    }
    if (!r.win) return { ok: false, msg: '不能胡' };
    // 天胡：必须真成型；3 金散牌只是三金倒，3 金成刻子才是「天胡金龙」
    const goldsInHand = p.hand.filter((t) => t === this.joker).length;
    const tianhu = tianhuCand && r.type === 'standard'
      && (goldsInHand < 3 || !!(r.feats || {}).jinlong);
    const menqing = p.melds.length === 0;
    const mingGang = p.melds.filter((m) => m.type === 'gang').length;
    const anGang = p.melds.filter((m) => m.type === 'angang').length;
    // 大单调：5 组副露 + 手上只剩 1 张（胡牌张就是它的对子）；
    //   手上剩 4 张（一搭 + 单张）只是普通"单钓将"，不算大单调。
    //   剩金（手上那一张是金）→ 摸什么都能胡，是"大单调(有金)"。
    const concealedLeft = zimo ? p.hand.length - 1 : p.hand.length; // 去掉刚摸到/别人打出的胡牌张
    const danDiao = p.melds.length === 5 && concealedLeft === 1;
    const danDiaoHasJin = danDiao && p.hand.includes(this.joker);
    const qianggang = !!extra.qianggang; // 抢杠胡（别人加杠被你抢）
    const jinkan = !!p.jinKan;

    const result = this.calcDaluan(r, {
      zimo, winner: p, from: zimo ? seat : fromSeat,
      mingGang, anGang, lianZhuang: this.lianZhuang,
      danDiao, danDiaoHasJin, qiangjin, qianggang, jinkan, extra, winTile, tianhu,
    });

    // 胡的是什么牌型（对对胡/金雀/…）。金雀不能点炮，但**抢金可以叠加**，
    //   所以只有"普通点炮"才把金雀标签去掉。
    let labels = MJ.labelsOf(r);
    if (!zimo && !qiangjin && (r.feats || {}).jinque) labels = labels.filter((x) => x !== '金雀');
    if (tianhu) labels = ['天胡', ...labels.filter((x) => x !== '天胡')];
    this.phase = 'ended';
    this.lastResult = { draw: false, winnerSeat: seat };
    this.jiangEnded = this.isJiangLastGame();
    // 累计输赢（跨局）：赢家收总额，付款人各扣自己那份；小数为 0.25 片时保留两位
    const totalPaid = (result.payers || []).reduce((s, x) => s + x.amount, 0);
    const deltas = {};
    for (const pl of this.players) deltas[pl.seat] = 0;
    deltas[seat] = totalPaid;
    for (const pay of (result.payers || [])) deltas[pay.seat] = (deltas[pay.seat] || 0) - pay.amount;
    for (const pl of this.players) pl.score = Math.round(((pl.score || 0) + (deltas[pl.seat] || 0)) * 100) / 100;
    this.winners = {
      seats: [seat], winner: seat, from: zimo ? seat : fromSeat, zimo,
      type: r.type, feats: r.feats, danDiao, danDiaoHasJin, jinkan, qiangjin, qianggang, tianhu,
      flowerCount: p.flowerCount, winTile, deltas,
      labels, ...result,
    };
    const labelTxt = labels.length ? `（${labels.join(' / ')}）` : '';
    this.log.push(`${p.name} ${zimo ? '自摸' : qianggang ? '抢杠胡' : '胡牌'}${labelTxt}！${result.summary}`);
    // 胡牌事件：big=有叠加奖励的大牌（前端据此放礼炮/撒金特效）；bonus 越大特效越足
    this.emit({
      ev: 'hu', seat, name: p.name, zimo: !!zimo, qiangjin: !!qiangjin, qianggang: !!qianggang,
      labels, fan: result.fan, bonus: result.bonusTotal || 0,
      big: (result.bonusTotal || 0) > 0, winTile, from: zimo ? seat : fromSeat,
    });
    this.broadcast();
    return { ok: true };
  }

  selfHu(seat) {
    if (seat !== this.turn || this.pending) return { ok: false, msg: '当前不可胡' };
    const p = this.getPlayer(seat);
    const ok = p.jinKan ? this.jinKanWin(p) : this.checkWinOf(p).win;
    if (!ok) return { ok: false, msg: '你没胡' };
    return this.doHu(seat, true, seat, {});
  }

  // 逆时针（座位号 +1 方向）从庄家下家起、庄家最后：抢金的表态优先级就是它
  seatOrderFromDealer() {
    const n = this.players.length;
    const out = [];
    for (let k = 1; k <= n; k++) out.push((this.dealer + k) % n);
    return out;
  }

  // 抢金这手"叠加的大牌值多少片"——只比大牌奖励部分（花/基础不计），
  //   用于多家同时抢金时定谁胡：大牌大的先抢。
  qiangjinValue(p) {
    const r = this.checkWinOf(p, [this.joker], { qiangjin: true });
    if (!r.win) return -1;
    const melds = p.melds || [];
    const danDiao = melds.length === 5 && p.hand.length === 1;
    const res = this.calcDaluan(r, {
      zimo: false, winner: p, from: this.dealer,
      mingGang: melds.filter((m) => m.type === 'gang').length,
      anGang: melds.filter((m) => m.type === 'angang').length,
      lianZhuang: this.lianZhuang,
      danDiao, danDiaoHasJin: danDiao && p.hand.includes(this.joker),
      qiangjin: true, qianggang: false, jinkan: false,
      extra: {}, winTile: this.joker, tianhu: false,
    });
    return res.bonusTotal != null ? res.bonusTotal : res.fan;
  }

  // 多人同时表示胡：抢金比大牌、点炮比顺序
  resolveMultipleHu(huList, fromSeat, isQiangjin) {
    if (huList.length === 1) return huList[0];
    if (isQiangjin) {
      // 抢金：先挑出真能抢的（拿公示金能成 17 张）。
      //   多家都能抢 → 叠加奖励大的优先；一样大 → 按逆时针（庄家下家先，庄家最后）。
      const qjSeats = huList.filter((s) => this.canQiangjin(this.getPlayer(s)));
      if (qjSeats.length === 1) return qjSeats[0];
      if (qjSeats.length > 1) {
        let best = null, bestVal = -1;
        for (const s of this.seatOrderFromDealer()) {
          if (!qjSeats.includes(s)) continue;
          const v = this.qiangjinValue(this.getPlayer(s));
          if (v > bestVal) { bestVal = v; best = s; }
        }
        return best != null ? best : qjSeats[0];
      }
      // 一个都抢不了 → 这手只是普通点炮，按放炮者下家顺序
    }
    // 点炮：从放炮者下家起，先轮到谁谁胡
    for (let k = 1; k <= this.players.length; k++) {
      const s = (fromSeat + k) % this.players.length;
      if (huList.includes(s)) return s;
    }
    return huList[0];
  }

  // ---------- 算分：大乱斗（朵数→片 + 大牌奖励，可叠加） ----------
  // 金规则：金只能当"赖子"留在手牌里用，不能吃/碰/杠（吃碰只认完全相同的牌、
  //   且不能吃碰别人打出的金；暗杠禁金；金坎是"宣告"不产生明子）→ 明子里永远没有金。
  //   计分：0花胡时，每枚金直接 +1 片；其他情况每枚金算 1 朵，与花牌合并算基础。
  //   显示：花（N）+自摸（1）+金（N）= 基础片（朵×2 再÷5 进1），大牌奖励另加。
  calcDaluan(r, ctx) {
    const f = r.feats;
    const p = ctx.winner;
    const flowers = p.flowerCount;
    const joker = this.joker;
    // 金计数：手牌里的金（明子里不会有金）+ 点炮/抢金胡进来的那张金
    //   抢金时手里 2 金、胡的又是金 → 这一手按 3 金算（3 张金都能当赖子用）
    const ronJin = (!ctx.zimo && ctx.winTile === joker) ? 1 : 0;
    const goldCount = p.hand.filter((t) => t === joker).length + ronJin;
    const isZeroFlower = flowers === 0;
    // 大牌判定（0花即大牌；0花时自摸不+1）
    const isBig = !!(f.sanjindao || f.youjinDuizi || f.wujinDuizi || f.jinque ||
      f.jinlong || f.hunyise || f.qingyise || ctx.qiangjin || ctx.qianggang || ctx.jinkan ||
      ctx.danDiao || ctx.tianhu || isZeroFlower);
    // 基础朵数组成（金仅在非0花时计入朵，与花牌合并）
    let duo = 0;
    const duoComp = [['花', flowers]]; // 花（含0花）始终展示
    duo += flowers;
    const mingGang = ctx.mingGang, anGang = ctx.anGang, lz = ctx.lianZhuang;
    if (mingGang) { duo += mingGang; duoComp.push(['明杠', mingGang]); }
    if (anGang) { duo += anGang * 2; duoComp.push(['暗杠', anGang * 2]); }
    if (lz) { duo += lz; duoComp.push(['连庄', lz]); }
    // 非大牌自摸 +1 朵（放在金之前，符合 花+自摸+金 展示顺序）
    let zimoDuo = 0;
    if (ctx.zimo && !isBig) { duo += 1; zimoDuo = 1; duoComp.push(['自摸', 1]); }
    if (!isZeroFlower && goldCount > 0) { duo += goldCount; duoComp.push(['金', goldCount]); }
    duo *= 2; // 自摸/大牌点炮 都 ×2
    const pieces = Math.ceil(duo / 5); // 余分也进 1 片
    const baseStr = duoComp.map(([n, v]) => `${n}（${v}）`).join('+') + `= ${pieces}片`;

    // 0花胡：金改算片（每枚1片，直接加，不进基础朵）
    let goldPieces = 0;
    if (isZeroFlower && goldCount > 0) goldPieces = goldCount;

    // 大牌奖励（片，加在基础之上，可叠加）
    const bonuses = [];
    const add = (name, val) => { if (val) bonuses.push([name, val]); };    if (ctx.tianhu) add('天胡', 8); // 庄家开局第一手成牌
    if (isZeroFlower) add('无花胡', 8);
    if (ctx.qiangjin) add('抢金', 8);
    if (f.sanjindao) add('三金倒', 10);
    if (f.youjinDuizi) add('有金对对胡', 8);
    if (f.wujinDuizi) add('无金对对胡', 12);
    // 金雀（双金作将）：自摸可以算；抢金也可以叠加 —— 抢来的公示金 + 手里 1 张金，
    //   正好凑成"金金作将"这一手。普通点炮不算（金雀不能点炮）。
    if (f.jinque && (ctx.zimo || ctx.qiangjin)) add('金雀', 12);
    if (ctx.jinkan) add('金坎', 12);
    if (ctx.danDiao) add(ctx.danDiaoHasJin ? '大单调(有金)' : '大单调', ctx.danDiaoHasJin ? 8 : 12);
    if (f.jinlong) add('金龙', 24);
    if (f.hunyise) add('混一色', 24);
    if (f.qingyise) add('纯清一色', 48);

    const total = pieces + goldPieces + bonuses.reduce((s, b) => s + b[1], 0);
    const bonusTotal = bonuses.reduce((s, b) => s + b[1], 0);
    const detail = [baseStr];
    if (isZeroFlower && goldCount > 0) detail.push(`金（${goldCount}）= ${goldCount}片`);
    for (const [n, v] of bonuses) detail.push(`${n}（${v}）`);

    const isQingHun = f.hunyise || f.qingyise;
    const summary = `片数=${total}（${detail.join(' ')}）`;
    const payers = this.spreadDaluan(total, ctx.zimo, ctx.from, isQingHun, p);
    return { fan: total, bonusTotal, summary, detail, payers };
  }

  // 大乱斗分摊（含包牌）。总额恒 3P（三家各应付 P），包牌重分配。
  //
  // 包牌的责任逻辑（别简化成"谁喂得多谁就赔"）：
  //   1. 有人做清/混一色，每一手吃碰杠都是别人在帮他凑牌型 —— 这是"助力"，
  //      喂得越多，他做成的概率越大，所以喂牌的人不能和旁观者出一样多。
  //   2. 但真正把牌型做实的是**最后一手**：都已经吃了三手同花色了，还往这个颜色上打，
  //      他再吃下去就报听了 —— 这一张的责任是明确的。所以"最后一手是谁喂的"先于"喂了几手"。
  //   3. 如果从头到尾都是同一个人喂（喂满 4 手以上），这个牌型就是他一手喂成的 → 全包。
  //   4. 点炮时，"最后一手"由放炮者扮演：最后那张是他打的，责任归他；
  //      喂牌的人在 3 手这一档不再额外承担（只付 1/4）。
  //
  // 注：副露最多 5 组，最后一手必须取数组末位，不能写死 provs[3]。
  spreadDaluan(pieces, zimo, from, isQingHun, winner) {
    const T = pieces;        // 单份
    const Am = 3 * T;        // 总额
    const payers = [];
    const others = this.players.filter((p) => p.seat !== winner.seat);
    const pushP = (seat, amt) => payers.push({ seat, amount: amt });

    const provs = winner.providers;
    const hc = provs.length;
    const lastFeeder = hc ? provs[hc - 1] : -1;                    // 最后一手是谁喂的
    const allSame = hc > 0 && provs.every((x) => x === provs[0]);  // 每一手都是同一个人喂的

    // 没到包牌门槛：自摸 / 点炮都是三家各付一份
    if (!isQingHun || hc < 3) {
      for (const p of others) pushP(p.seat, T);
      return payers;
    }

    if (zimo) {
      if (allSame && hc >= 4) {
        pushP(lastFeeder, Am);                                   // 一手喂成：全包，另外两家 0
      } else {
        pushP(lastFeeder, Am / 2);                               // 最后一手的人担一半
        for (const p of others) if (p.seat !== lastFeeder) pushP(p.seat, Am / 4);
      }
    } else if (allSame && hc >= 4) {
      // 牌型是 A 一手喂成的，但最后一张是 C 打的：两人各半，第三人不出
      if (lastFeeder === from) pushP(from, Am);
      else { pushP(from, Am / 2); pushP(lastFeeder, Am / 2); }
    } else if (hc >= 4) {
      pushP(from, Am);                                           // 喂牌的人不统一：最后那张谁打的谁全担
    } else {
      pushP(from, Am / 2);                                       // 3 手：放炮者一半，其余两家各 1/4
      for (const p of others) if (p.seat !== from) pushP(p.seat, Am / 4);
    }
    return payers;
  }

  // ---------- 序列化 ----------
  getState(forSeat) {
    const revealAll = this.phase === 'ended'; // 结算时四家手牌全部亮出
    const players = this.players.map((p) => {
      const isSelf = p.seat === forSeat;
      // 本人"这手胡的是什么牌型"：自摸 / 点炮 / 抢杠都用真实牌面算一遍，
      // 让按钮直接写清"自摸·金雀""胡·对对胡"，不会糊里糊涂点碰把胡丢了
      let huInfo = null, jinQueTiles = [];
      if (isSelf && this.phase === 'playing' && !p.jinKan) {
        if (!this.pending && this.turn === p.seat && this.selfCanHu) {
          const zl = MJ.labelsOf(this.checkWinOf(p));
          huInfo = { kind: 'zimo', labels: this.isTianHuWin(p) ? ['天胡', ...zl] : zl };
        } else if (this.pending && (this.pending.seats || []).includes(p.seat)) {
          const entry = (this.pending.acts || []).find((a) => a.seat === p.seat);
          if (entry && entry.acts.includes('hu')) {
            const pend = this.pending;
            // 抢金：拿公示金能胡 → 按钮直接写"抢金"，牌型标签按公示金这张算
            const isQj = !!pend.qiangjin && pend.kind !== 'qianggang' && this.canQiangjin(p);
            huInfo = {
              kind: pend.kind === 'qianggang' ? 'qianggang' : (isQj ? 'qiangjin' : 'ron'),
              // 抢金可以和金雀/金龙/对对胡/清混叠加，所以抢金时**保留**金雀标签；
              //   普通点炮/抢杠不标金雀；三金倒永远不跟抢金叠加，一律过滤。
              labels: this.labelsOf(p, [isQj ? this.joker : pend.tile],
                isQj ? { qiangjin: true, sanjindao: false } : { sanjindao: false })
                .filter((x) => x !== '三金倒' && (isQj || x !== '金雀')),
              qiangjinTile: isQj ? this.joker : null,
            };
          }
        }
        if (!huInfo) jinQueTiles = this.jinQueWaitTiles(p);
      }
      return {
        seat: p.seat, name: p.name, isHost: p.isHost, connected: p.connected, isBot: !!p.isBot,
        isCurrent: p.seat === this.turn && this.phase === 'playing',
        handCount: p.hand.length,
        // 金坎后手牌全部盖倒：连自己也不下发牌面，只给张数（结算时统一亮出）
        hand: ((isSelf && !p.jinKan) || revealAll) ? sortHand(p.hand, this.joker < 0 ? 999 : this.joker) : undefined,
        melds: p.melds.map((m) => ({ type: m.type, tiles: m.tiles, from: m.from })),
        discards: p.discards, flowerCount: p.flowerCount,
        eatPongCount: p.eatPongCount, declaredTing: p.declaredTing, jinKan: p.jinKan,
        score: p.score || 0,
        // 刚摸上来的那张：只告诉自己，前端会把它单独摆在手牌最右边，出牌后才归位排序
        drawn: (isSelf && !revealAll && !p.jinKan && p.lastDrawn >= 0 &&
          p.hand.length % 3 === 2 && p.hand.includes(p.lastDrawn)) ? p.lastDrawn : null,
        huInfo, jinQueTiles,
      };
    });
    let actions = [];
    const self = this.players.find((p) => p.seat === forSeat);
    if (self && this.phase === 'playing') {
      if (this.pending && this.pending.seats.includes(forSeat) && !this.pending.responded.has(forSeat)) {
        const entry = this.pending.acts.find((s) => s.seat === forSeat);
        actions = entry ? entry.acts.concat(['pass']) : ['pass'];
      } else if (this.turn === forSeat && !this.pending) {
        if (!self.jinKan) actions = ['discard']; // 金坎后手牌盖倒，只摸不挑
        if (this.selfCanHu) actions.push('hu');
        if (self.eatPongCount >= 3 && !self.declaredTing && this.isQingHunShape(self)) actions.push('ting');
        if (this.canJinKan(self)) actions.push('jinkan');
        const cnts = {};
        for (const t of self.hand) cnts[t] = (cnts[t] || 0) + 1;
        const wallEmpty = this.wall.length === 0; // 牌墙空了不能杠（补不出牌）
        if (!wallEmpty) {
          for (const t in cnts) if (cnts[t] >= 4 && Number(t) !== this.joker) actions.push('angang:' + t);
        }
        // 加杠：碰过、手里还留着第 4 张（摸牌后 3n+2 张时才能杠）
        if (!wallEmpty && !self.jinKan && !this.jinKanActive && self.hand.length % 3 === 2) {
          for (const m of self.melds) {
            if (m.type !== 'peng' || m.tiles.length !== 3) continue;
            const t = m.tiles[0];
            if (t === this.joker) continue;
            if (!self.hand.includes(t)) continue;
            if (actions.includes('bugang:' + t)) continue;
            actions.push('bugang:' + t);
          }
        }
      }
    } else if (self && this.phase === 'swap' && this.swap) {
      const already = this.swap.choices[forSeat] != null;
      actions = already ? [] : ['swap:chooseSuit'];
    }
    return {
      roomId: this.id, phase: this.phase, mode: 'daluandou', turn: this.turn, dealer: this.dealer,
      joker: this.joker, jokerName: this.joker >= 0 ? MJ.TILE_NAMES[this.joker] : '未定',
      wallLeft: this.wall.length, lastDiscard: this.lastDiscard, dealDice: this.dealDice,
      pending: this.pending ? {
        by: this.pending.by, tile: this.pending.tile, seats: this.pending.seats,
        kind: this.pending.kind || null,
        qiangjin: !!this.pending.qiangjin,
        chiWait: this.pending.chiIntent ? this.pending.chiIntent.seat : null,
        pengIntent: this.pending.pengIntent ? this.pending.pengIntent.seat : null,
        // 还在等谁表态胡（前端据此提示"等 XX 决定胡不胡"）
        huWait: this.pending.seats.filter((sd) => !this.pending.responded.has(sd) &&
          (this.pending.acts || []).some((a) => a.seat === sd && a.acts.includes('hu'))),
        // 抢金窗口里还没决定抢不抢的家（吃碰杠要等这几家）
        qjWait: (this.pending.qjSeats || []).filter((sd) => !this.pending.responded.has(sd)),
        xiaoHu: this.pending.xiaoHu || [],
        pengWait: this.pending.seats.filter((sd) => !this.pending.responded.has(sd) &&
          (this.pending.acts || []).some((a) => a.seat === sd && a.acts.some((x) => x === 'peng' || x === 'gang'))),
      } : null,
      swap: (this.phase === 'swap' && this.swap) ? {
        id: this.swap.id, diceSum: this.swap.diceSum, dice: this.swap.dice || null,
        dir: this.swap.dir, dirText: dirText(this.swap.dir),
        // 自己这次把牌给谁（相对方位 + 名字），前端直接显示"你 → 上家（张三）"
        giveTo: this.swapGiveTo(forSeat),
        // 只下发"谁已经选好了"，不下发别人选的花色（自己的 yourChoice 除外）
        chosen: this.players.map((pl) => this.swap.choices[pl.seat] != null),
        yourChoice: this.swap.choices[forSeat] != null ? this.swap.choices[forSeat] : null,
      } : null,
      players, actions, winners: this.winners, log: this.log.slice(-16), selfSeat: forSeat,
      jinKanActive: this.jinKanActive, lianZhuang: this.lianZhuang, roundNo: this.roundNo,
      quanNo: this.quanNo, quanDealerCount: this.quanDealerCount,
      jiangNo: this.jiangNo, jiangEnded: this.jiangEnded,
    };
  }

  broadcast() {
    // 事件只跟着本次广播走一次：先取走再发，避免重连/重发时重复播放音效
    const evs = this.events.length ? this.events.splice(0, this.events.length) : null;
    for (const p of this.players) {
      if (p.ws && p.connected) {
        try { p.ws.send(JSON.stringify({ t: 'state', state: this.getState(p.seat), events: evs })); }
        catch (e) { /* ignore */ }
      }
    }
    this.scheduleBots();
  }
}

module.exports = { Room, sortHand };
