/**
 * 福麻大乱斗学习模拟器 核心引擎（纯函数，前后端通用）
 * ==============================================================
 * 牌编码（0-62，共63种，144张）：
 *   0-8    万 1-9   （各4张，共36）
 *   9-17   条 1-9   （各4张，共36）
 *   18-26  筒 1-9   （各4张，共36）
 *   27-62  花牌     （共36张，只计分 + 补花，不参与牌型）
 *           27-34  传统花：春夏秋冬梅兰竹菊（各1）
 *           35-62  原字牌当花：东南西北中发白（各4张，共28）
 *
 * 福麻没有可碰可吃的“字牌”——原字牌全部是花。
 *
 * 金（百搭/万能牌）：开局翻一张数牌，该种类全部4张为金。
 *   其中1张公共展示，场下实际3张可用作百搭。
 *
 * 大牌（可叠加）判定见 checkWin / analyzeFeats。
 * 本模块为纯函数，UMD 兼容（require / window.MJ）。
 */

// ---------- 牌名 ----------
const WAN = ['一万', '二万', '三万', '四万', '五万', '六万', '七万', '八万', '九万'];
const TIAO = ['一条', '二条', '三条', '四条', '五条', '六条', '七条', '八条', '九条'];
const TONG = ['一筒', '二筒', '三筒', '四筒', '五筒', '六筒', '七筒', '八筒', '九筒'];
// 36 张花：8 传统 + 28 原字牌（东南西北中发白各4）
const HUA_TRAD = ['春', '夏', '秋', '冬', '梅', '兰', '竹', '菊'];
const HUA_ZI = ['东', '南', '西', '北', '中', '發', '白'];

const TILE_NAMES = (() => {
  const n = [];
  for (let i = 0; i < 9; i++) n.push(WAN[i]);
  for (let i = 0; i < 9; i++) n.push(TIAO[i]);
  for (let i = 0; i < 9; i++) n.push(TONG[i]);
  for (let i = 0; i < 8; i++) n.push(HUA_TRAD[i]);
  for (let z = 0; z < 7; z++) for (let k = 0; k < 4; k++) n.push(HUA_ZI[z]);
  return n; // length 63 (0-62)
})();

const NUMERAL = 27;      // 数牌种类数 0-26
const FLOWER_BASE = 27;  // 花牌起始编码
const FLOWER_COUNT = 36; // 花牌总数

function suitOf(tile) {
  if (tile >= FLOWER_BASE) return 'f';
  if (tile < 9) return 'm';
  if (tile < 18) return 's';
  return 'p';
}
function rankOf(tile) {
  if (tile >= FLOWER_BASE) return tile - FLOWER_BASE + 1;
  return (tile % 9) + 1;
}
function isNumeral(tile) { return tile < FLOWER_BASE; }
function isFlower(tile) { return tile >= FLOWER_BASE; }

// ---------- 牌堆 / 洗牌 ----------
function buildDeck() {
  const deck = [];
  for (let t = 0; t < NUMERAL; t++) for (let k = 0; k < 4; k++) deck.push(t);
  for (let t = FLOWER_BASE; t < FLOWER_BASE + FLOWER_COUNT; t++) deck.push(t); // 花牌各1张
  return deck; // 108 + 36 = 144
}
function shuffle(arr, rng = Math.random) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// 分离：非花牌计 counts(27)；金计 jokers；花计 flowers
function separateJokers(tiles, jokerTile) {
  const counts = new Array(NUMERAL).fill(0);
  let jokers = 0, flowers = 0;
  for (const t of tiles) {
    if (t >= FLOWER_BASE) { flowers++; continue; }
    if (t === jokerTile) jokers++;
    else counts[t]++;
  }
  return { counts, jokers, flowers };
}

// ---------- 胡牌分解（含金） ----------
// 把剩余牌分解成 need 个面子（刻子/顺子），金作百搭，不含将。
function formMelds(counts, jokers, need) {
  let i = 0;
  while (i < NUMERAL && counts[i] === 0) i++;
  if (i === NUMERAL) {
    if (need === 0) return [];
    if (jokers === 3 * need) {
      const melds = [];
      for (let k = 0; k < need; k++) melds.push({ type: 'ke', tiles: ['J', 'J', 'J'], joker: 3 });
      return melds;
    }
    return null;
  }
  if (need === 0) return null;

  // 刻子方向
  if (counts[i] >= 3) {
    counts[i] -= 3;
    const r = formMelds(counts, jokers, need - 1);
    counts[i] += 3;
    if (r) return [{ type: 'ke', tiles: [i, i, i], joker: 0 }, ...r];
  }
  if (counts[i] >= 2 && jokers >= 1) {
    counts[i] -= 2;
    const r = formMelds(counts, jokers - 1, need - 1);
    counts[i] += 2;
    if (r) return [{ type: 'ke', tiles: [i, i, 'J'], joker: 1 }, ...r];
  }
  if (counts[i] >= 1 && jokers >= 2) {
    counts[i] -= 1;
    const r = formMelds(counts, jokers - 2, need - 1);
    counts[i] += 1;
    if (r) return [{ type: 'ke', tiles: [i, 'J', 'J'], joker: 2 }, ...r];
  }
  if (jokers >= 3) {
    const r = formMelds(counts, jokers - 3, need - 1);
    if (r) return [{ type: 'ke', tiles: ['J', 'J', 'J'], joker: 3 }, ...r];
  }

  // 顺子方向（数牌）
  if (i < NUMERAL && (i % 9) <= 6) {
    const a = i, b = i + 1, c = i + 2;
    if (counts[a] >= 1 && counts[b] >= 1 && counts[c] >= 1) {
      counts[a]--; counts[b]--; counts[c]--;
      const r = formMelds(counts, jokers, need - 1);
      counts[a]++; counts[b]++; counts[c]++;
      if (r) return [{ type: 'shun', tiles: [a, b, c], joker: 0 }, ...r];
    }
    if (counts[a] >= 1 && counts[b] >= 1 && jokers >= 1) {
      counts[a]--; counts[b]--;
      const r = formMelds(counts, jokers - 1, need - 1);
      counts[a]++; counts[b]++;
      if (r) return [{ type: 'shun', tiles: [a, b, 'J'], joker: 1 }, ...r];
    }
    if (counts[a] >= 1 && counts[c] >= 1 && jokers >= 1) {
      counts[a]--; counts[c]--;
      const r = formMelds(counts, jokers - 1, need - 1);
      counts[a]++; counts[c]++;
      if (r) return [{ type: 'shun', tiles: [a, 'J', c], joker: 1 }, ...r];
    }
    if (counts[b] >= 1 && counts[c] >= 1 && jokers >= 1) {
      counts[b]--; counts[c]--;
      const r = formMelds(counts, jokers - 1, need - 1);
      counts[b]++; counts[c]++;
      if (r) return [{ type: 'shun', tiles: ['J', b, c], joker: 1 }, ...r];
    }
    if (counts[a] >= 1 && jokers >= 2) {
      counts[a]--;
      const r = formMelds(counts, jokers - 2, need - 1);
      counts[a]++;
      if (r) return [{ type: 'shun', tiles: [a, 'J', 'J'], joker: 2 }, ...r];
    }
    if (counts[b] >= 1 && jokers >= 2) {
      counts[b]--;
      const r = formMelds(counts, jokers - 2, need - 1);
      counts[b]++;
      if (r) return [{ type: 'shun', tiles: ['J', b, 'J'], joker: 2 }, ...r];
    }
    if (counts[c] >= 1 && jokers >= 2) {
      counts[c]--;
      const r = formMelds(counts, jokers - 2, need - 1);
      counts[c]++;
      if (r) return [{ type: 'shun', tiles: ['J', 'J', c], joker: 2 }, ...r];
    }
    if (jokers >= 3) {
      const r = formMelds(counts, jokers - 3, need - 1);
      if (r) return [{ type: 'shun', tiles: ['J', 'J', 'J'], joker: 3 }, ...r];
    }
  }
  return null;
}

// 按"恰好 need 个面子 + 1 将"分解，返回 {pair, melds} 或 null
function decomposeNeed(counts, jokers, need) {
  if (!Number.isInteger(need) || need < 0 || need > 5) return null;
  const total = counts.reduce((a, b) => a + b, 0) + jokers;
  if (total !== need * 3 + 2) return null;
  for (let i = 0; i < NUMERAL; i++) {
    const c = counts.slice();
    let j = jokers;
    let pair;
    if (c[i] >= 2) { c[i] -= 2; pair = { tile: i, joker: 0 }; }
    else if (c[i] >= 1 && j >= 1) { c[i] -= 1; j -= 1; pair = { tile: i, joker: 1 }; }
    else if (j >= 2) { j -= 2; pair = { tile: 'J', joker: 2 }; }
    else continue;
    const melds = formMelds(c, j, need);
    if (melds) return { pair, melds };
  }
  return null;
}

// 标准型：n 面子 + 1 将，返回 {pair, melds} 或 null
// 福麻是 16 张制：胡牌 17 张 = 5 面子 + 将；同时兼容 14 张（4 面子）的旧用例
function decomposeStandard(counts, jokers) {
  const total = counts.reduce((a, b) => a + b, 0) + jokers;
  const need = (total - 2) / 3;
  return decomposeNeed(counts, jokers, need);
}

// 碰碰胡（对对胡）独立检测：4 刻 + 将
// 暗牌能不能刚好拆成 need 个刻子 + 1 将（金可补刻子/将）
function canAllKe(counts, jokers, need) {
  if (!Number.isInteger(need) || need < 0) return false;
  for (let i = 0; i < NUMERAL; i++) {
    const c = counts.slice();
    let j = jokers;
    if (c[i] >= 2) c[i] -= 2;
    else if (c[i] >= 1 && j >= 1) { c[i] -= 1; j -= 1; }
    else if (j >= 2) { j -= 2; }
    else continue;
    let sets = 0, ok = true;
    for (let k = 0; k < NUMERAL; k++) {
      let rem = c[k];
      while (rem > 0) {
        if (rem >= 3) { rem -= 3; sets++; }
        else {
          const needJ = 3 - rem;
          if (j >= needJ) { j -= needJ; rem = 0; sets++; }
          else { ok = false; break; }
        }
      }
      if (!ok) break;
    }
    if (ok && j === 0 && sets === need) return true;
  }
  return false;
}

function detectPengPeng(counts, jokers) {
  for (let i = 0; i < NUMERAL; i++) {
    const c = counts.slice();
    let j = jokers;
    if (c[i] >= 2) c[i] -= 2;
    else if (c[i] >= 1 && j >= 1) { c[i] -= 1; j -= 1; }
    else if (j >= 2) { j -= 2; }
    else continue;
    let ok = true;
    for (let k = 0; k < NUMERAL; k++) {
      let rem = c[k];
      while (rem > 0) {
        if (rem >= 3) rem -= 3;
        else {
          const needJ = 3 - rem;
          if (j >= needJ) { j -= needJ; rem = 0; }
          else { ok = false; break; }
        }
      }
      if (!ok) break;
    }
    if (ok) return true;
  }
  return false;
}

// ---------- 番型特征分析 ----------
// 金雀：2 张金「都作将」（金金做雀头），剩下 15 张数牌必须自己成 5 组面子。
//   只看"手里有 2 张金"是不够的 —— 很多时候一张金要去补面子/搭子，
//   这时金不是雀头，只是普通百搭，按普通胡算（否则摸到别的牌胡也会误判金雀）。
function canJinQue(counts, jokers) {
  if (jokers !== 2) return false;
  const total = counts.reduce((a, b) => a + b, 0) + jokers;
  const need = (total - 2) / 3;
  if (!Number.isInteger(need) || need < 1) return false;
  // 双金作将后，金一张都不能再进面子（jokers 传 0）
  return !!formMelds(counts.slice(), 0, need);
}

// 金龙：3 张金「自成一组刻子」（金金金），其余牌另凑 4 面子 + 将。
function canJinLong(counts, jokers) {
  if (jokers < 3) return false;
  const total = counts.reduce((a, b) => a + b, 0) + jokers;
  const need = (total - 2) / 3;
  if (!Number.isInteger(need) || need < 2) return false;
  // 摘掉 3 张金当一坎，剩下的必须独立成 standard 牌型
  return !!decomposeStandard(counts.slice(), jokers - 3);
}

function analyzeFeats(counts, jokers, jokerTile) {
  const feats = {
    pengpeng: false,
    youjinDuizi: false,  // 有金对对胡
    wujinDuizi: false,   // 无金对对胡
    jinque: false,       // 金雀：2 金作将
    jinlong: false,      // 金龙：3 金作刻（且成牌型）
    sanjindao: false,    // 三金倒：手牌 3 金即胡
    qingyise: false,     // 纯清一色
    hunyise: false,      // 混一色
  };

  // 花色：数牌非金部分的花色集合
  const suits = new Set();
  for (let t = 0; t < NUMERAL; t++) if (counts[t] > 0) suits.add(suitOf(t));
  const goldSuit = jokerTile >= 0 ? suitOf(jokerTile) : null;

  if (suits.size === 1) {
    const s = [...suits][0];
    if (jokers === 0) feats.qingyise = true;            // 无金，全一门 → 清
    else if (goldSuit === s) feats.qingyise = true;     // 有金且金同花 → 清
    else feats.hunyise = true;                          // 有金且金异花 → 混
  }
  // suits.size > 1 或非数牌：非清非混

  // 对对胡
  feats.pengpeng = detectPengPeng(counts, jokers);
  feats.youjinDuizi = feats.pengpeng && jokers >= 1;
  feats.wujinDuizi = feats.pengpeng && jokers === 0;

  // 金相关：必须是"金本身作将/作刻"才算，不能只看张数
  feats.jinque = canJinQue(counts, jokers);        // 2 金都作将（金金做雀头）
  feats.jinlong = canJinLong(counts, jokers);      // 3 金自成一刻
  feats.sanjindao = jokers >= 3;                   // 三金倒（手牌 3 金即胡）

  return feats;
}

// 胡牌牌型标签：用于"胡/自摸"按钮与结算标题，让玩家一眼看清自己胡的是什么
function labelsOf(r) {
  if (!r || !r.win) return [];
  const f = r.feats || {};
  const L = [];
  if (f.qingyise) L.push('纯清一色');
  if (f.hunyise) L.push('混一色');
  if (f.jinlong) L.push('金龙');
  if (f.jinque) L.push('金雀');
  if (f.youjinDuizi) L.push('对对胡（有金）');
  if (f.wujinDuizi) L.push('对对胡');
  if (r.type === 'sanjindao' || f.sanjindao) L.push('三金倒');
  // 没有大牌奖励的普通胡不标：大乱斗里最小胡就是普通自摸，按钮写"自摸"就够
  return L;
}
function winLabels(tiles, jokerTile) {
  return labelsOf(checkWin(tiles, jokerTile));
}

// ---------- 副露感知的胡牌判定 ----------
// 关键：吃/碰/杠亮出去的那 3 张是"已经定死的面子"，不能倒回手里重新组合。
//   反例：碰了 九条×3，手里还有 一二三四五条 + 四五六筒，
//   摊平后能凑成 123条 + 456条 + 789条 + 99条（拿两张碰出去的九条当将）→ 非法却会被判胡。
//   正确口径：暗牌（+ 别人打出的那张）必须自己凑成 (5 - 副露数) 个面子 + 1 将。
// opts.qiangjin：抢金胡（胡的那张就是金）。抢金时手里 2 金 + 抢进第 3 金，
//   这三张金允许拆开当赖子分配到各面子/将里，按真实牌型算，不按"三金倒"。
function checkWinEx(hand, melds = [], jokerTile = -1, opts = {}) {
  const { counts, jokers, flowers } = separateJokers(hand, jokerTile);
  const meldList = melds || [];
  const need = 5 - meldList.length;
  const feats = {
    pengpeng: false, youjinDuizi: false, wujinDuizi: false,
    jinque: false, jinlong: false, sanjindao: false,
    qingyise: false, hunyise: false,
  };
  if (need < 0) return { win: false, jokers, flowers, feats };

  // 花色：暗牌 + 副露（副露里的金位占位符 'J' 跳过）
  const suits = new Set();
  const addTile = (t) => { if (t >= 0 && t < NUMERAL && t !== jokerTile) suits.add(suitOf(t)); };
  for (let t = 0; t < NUMERAL; t++) if (counts[t] > 0) addTile(t);
  for (const m of meldList) for (const t of (m.tiles || [])) if (typeof t === 'number') addTile(t);
  if (suits.size === 1) {
    const s = [...suits][0];
    const goldSuit = jokerTile >= 0 ? suitOf(jokerTile) : null;
    if (jokers === 0) feats.qingyise = true;
    else if (goldSuit === s) feats.qingyise = true;
    else feats.hunyise = true;
  }

  const std = decomposeNeed(counts, jokers, need);

  // 金雀：双金都作将，暗牌剩下的数牌自己成 need 个面子（金不能再进面子）
  if (jokers === 2) feats.jinque = !!formMelds(counts.slice(), 0, need);
  // 金龙：3 张金自成一刻，其余暗牌成 (need-1) 个面子 + 将
  if (jokers >= 3 && need >= 1) feats.jinlong = !!decomposeNeed(counts.slice(), jokers - 3, need - 1);
  // 三金倒只能自摸：点炮/抢杠一律不标（opts.sanjindao === false 时彻底关掉，
  //   手牌不成型就不算胡，成型也只按普通/大牌牌型算，不加三金倒那 10 片）
  if (jokers >= 3 && !opts.qiangjin && opts.sanjindao !== false) feats.sanjindao = true;
  // 抢金时 3 金不当三金倒：金可以拆开补面子，必须真的凑成牌型才算胡

  if (std) {
    // 对对胡：副露必须全是碰/杠，暗牌分解也必须全是刻子（吃过的就不算）
    const fixedKe = meldList.every((m) => m.type === 'peng' || m.type === 'gang' || m.type === 'angang');
    feats.pengpeng = fixedKe && canAllKe(counts, jokers, need);
    feats.youjinDuizi = feats.pengpeng && jokers >= 1;
    feats.wujinDuizi = feats.pengpeng && jokers === 0;
    if (feats.jinlong) feats.sanjindao = false;
    return { win: true, type: 'standard', jokers, flowers, decomp: std, feats };
  }
  if (jokers >= 3 && !opts.qiangjin && opts.sanjindao !== false) {
    feats.jinlong = false;
    return { win: true, type: 'sanjindao', jokers, flowers, decomp: null, feats };
  }
  return { win: false, jokers, flowers, feats };
}


// tiles：完整手牌（含已亮明子 + 暗牌，花牌会被忽略），jokerTile：金种类
// 返回 { win, type, jokers, flowers, feats, decomp }
function checkWin(tiles, jokerTile) {
  const { counts, jokers, flowers } = separateJokers(tiles, jokerTile);
  const std = decomposeStandard(counts, jokers);
  const feats = analyzeFeats(counts, jokers, jokerTile);

  if (std) {
    // 成牌型：金龙(3金自成刻) 优先于 三金倒；3 金却没凑成"金金金"的，
    // 说明金都被拆去补面子了 → 仍按三金倒算（手牌 3 金即胡）
    if (feats.jinlong) feats.sanjindao = false;
    return { win: true, type: 'standard', jokers, flowers, decomp: std, feats };
  }
  if (jokers >= 3) {
    // 三金倒：手牌 3 金即胡，不需牌型
    feats.jinlong = false;
    return { win: true, type: 'sanjindao', jokers, flowers, decomp: null, feats };
  }
  return { win: false, jokers, flowers };
}

// 金坎听牌判定：是否“再摸一张金即胡”（卡金单钓）
// 用于玩家声明金坎前的可行性校验。
// 金坎听牌（严格口径）：
// 1) 手里必须一张金都没有（已经摸到金就不能再宣告金坎）
// 2) 金是数牌且不是边张 1/9
// 3) 手里正好有「金前一张」和「金后一张」（如金=6万，就要 5万 + 7万），即"卡"在金位上
// 4) 把这两张拿掉后，剩下的 11 张必须自成 3 个面子 + 1 个将（不含任何金）
function isJinKanWait(tiles, jokerTile) {
  if (!(jokerTile >= 0 && jokerTile < NUMERAL)) return false;
  if (tiles.includes(jokerTile)) return false;      // 手里有金 → 不能做金坎
  if (tiles.length % 3 !== 1) return false;         // 必须是 3n+1 张的听牌形态
  const r = rankOf(jokerTile);
  if (r <= 1 || r >= 9) return false;               // 边张没有"坎"
  const lo = jokerTile - 1, hi = jokerTile + 1;
  const rest = tiles.slice();
  const i1 = rest.indexOf(lo); if (i1 < 0) return false;
  rest.splice(i1, 1);
  const i2 = rest.indexOf(hi); if (i2 < 0) return false;
  rest.splice(i2, 1);
  if (rest.includes(jokerTile)) return false;
  const { counts, jokers } = separateJokers(rest, jokerTile);
  if (jokers !== 0) return false;
  const need = (rest.length - 2) / 3;               // 11 张 → 3 个面子
  if (!Number.isInteger(need) || need < 0) return false;
  for (let i = 0; i < NUMERAL; i++) {
    if (counts[i] >= 2) {
      const c = counts.slice();
      c[i] -= 2;
      if (formMelds(c, 0, need)) return true;
    }
  }
  return false;
}

// 听牌判断：13 张（花忽略）基础上是否听牌
function isTing(tiles, jokerTile) {
  const { counts, jokers } = separateJokers(tiles, jokerTile);
  for (let t = 0; t < NUMERAL; t++) {
    if (t === jokerTile) {
      if (jokers >= 4) continue;
      if (checkWin([...tiles, t], jokerTile).win) return true;
    } else {
      if (counts[t] >= 4) continue;
      if (checkWin([...tiles, t], jokerTile).win) return true;
    }
  }
  return false;
}

// 副露感知的听牌判断：暗牌再摸一张是否能胡（副露的面子固定，不能拆）
function isTingEx(hand, melds = [], jokerTile = -1) {
  const used = new Array(NUMERAL).fill(0);
  for (const t of hand) if (t >= 0 && t < NUMERAL) used[t]++;
  for (const m of (melds || [])) for (const t of (m.tiles || [])) if (typeof t === 'number' && t < NUMERAL) used[t]++;
  for (let t = 0; t < NUMERAL; t++) {
    if (used[t] >= 4) continue;
    if (checkWinEx([...hand, t], melds, jokerTile).win) return true;
  }
  return false;
}

// ---------- 导出 ----------
const MJ = {
  TILE_NAMES, NUMERAL, FLOWER_BASE, FLOWER_COUNT, suitOf, rankOf, isNumeral, isFlower,
  buildDeck, shuffle, separateJokers,
  checkWin, checkWinEx, isTing, isTingEx, isJinKanWait, winLabels, labelsOf,
  decomposeStandard, decomposeNeed, formMelds, canAllKe, detectPengPeng, analyzeFeats,
};

if (typeof module !== 'undefined' && module.exports) module.exports = MJ;
if (typeof window !== 'undefined') window.MJ = MJ;
