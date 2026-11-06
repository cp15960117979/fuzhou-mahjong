// 福麻大乱斗学习模拟器 前端逻辑
// 牌编码与后端一致: 0-8万 9-17条 18-26筒, 27-62 花牌(27-34四季四君子, 35-62 东南西北中发白×4)
const TILE_NAMES = (() => {
  const names = [];
  const wan = ['一万','二万','三万','四万','五万','六万','七万','八万','九万'];
  const tiao = ['一条','二条','三条','四条','五条','六条','七条','八条','九条'];
  const tong = ['一筒','二筒','三筒','四筒','五筒','六筒','七筒','八筒','九筒'];
  const hua = ['春','夏','秋','冬','梅','兰','竹','菊',
    '东','东','东','东','南','南','南','南','西','西','西','西','北','北','北','北',
    '中','中','中','中','发','发','发','发','白','白','白','白'];
  for (let i=0;i<9;i++) names.push(wan[i]);
  for (let i=0;i<9;i++) names.push(tiao[i]);
  for (let i=0;i<9;i++) names.push(tong[i]);
  for (let i=0;i<36;i++) names.push(hua[i]);
  return names;
})();
function suitClass(i){ if(i<9) return 'm'; if(i<18) return 's'; if(i<27) return 'p'; return 'f'; }

const WS_URL = (location.protocol === 'https:' ? 'wss' : 'ws') + '://' + location.host;
let ws = null;
let state = null;
let mySeat = null;
let swapSelection = []; // 换牌阶段：手动挑选的下标（指向该花色的牌列表）——按"张"选，同点数的两张可以只选一张
let swapSuit = null;    // 换牌阶段：本地选定的花色（点击花色先本地记录，确认时再提交）
let curSwapId = -1;     // 当前换牌轮次 id（服务端递增），变化即重置本地选择
let swapSubmitted = false; // 本地已点过"确认"（等待服务端回执）
let swapSubmitAt = 0;   // 点确认的时间，用于超时重试

// 连接未就绪时先入队，避免"点创建房间没反应"
const outbox = [];
function connect() {
  ws = new WebSocket(WS_URL);
  ws.onopen = () => { while (outbox.length) { try { ws.send(JSON.stringify(outbox.shift())); } catch { break; } } };
  ws.onmessage = (ev) => { handle(JSON.parse(ev.data)); };
  ws.onclose = () => { showMsg('与服务器断开，请刷新页面', true); };
}
function send(obj){
  if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return; }
  outbox.push(obj);
  if (outbox.length === 1) showMsg('正在连接服务器…');
}

function handle(msg){
  switch(msg.t){
    case 'created': mySeat = msg.seat; showGame(); break;
    case 'joined': mySeat = msg.seat; showGame(); break;
    case 'state': state = msg.state; render(); break;
    case 'error': showMsg(msg.msg, true); break;
  }
}

// ---------- 视图切换 ----------
function showGame(){ document.getElementById('lobby').classList.remove('active'); document.getElementById('game').classList.add('active'); }
function showMsg(text, isErr){ const el=document.getElementById('lobbyMsg'); el.textContent=text; el.style.color=isErr?'#ffb3b3':'#dfffdf'; }

function nameOf(seat){ const p = state && state.players.find(x=>x.seat===seat); return p ? p.name : ('座位'+seat); }
function isHost(){ return state && state.selfSeat === 0; }
// 片数显示：整数不带小数，四分之一片保留两位
function fmtPts(n){
  const v = Math.round((n||0)*100)/100;
  return Number.isInteger(v) ? String(v) : v.toFixed(2);
}
// 累计输赢小标签（下一局起挂在每个玩家信息框里）
function scoreChip(n){
  const v = Math.round((n||0)*100)/100;
  if(!v) return '';
  const cls = v>0 ? 'up' : 'down';
  return `<span class="score ${cls}">${v>0?'+':''}${fmtPts(v)}片</span>`;
}

// ---------- 渲染总入口 ----------
function render(){
  if(!state) return;
  document.getElementById('roomCode').textContent='房间 '+state.roomId;
  // 顶栏的「金」：文字旁边直接放一张牌，比只写"七筒"更直观
  const ji = document.getElementById('jokerInfo');
  ji.innerHTML = '';
  const jl = document.createElement('span'); jl.className = 'jk-label'; jl.textContent = '金';
  ji.appendChild(jl);
  if (state.joker != null && state.joker >= 0) {
    const jt = tileEl(state.joker, { small: true, joker: true });
    jt.classList.add('jk-tile');
    ji.appendChild(jt);
    const jn = document.createElement('span'); jn.className = 'jk-name'; jn.textContent = state.jokerName;
    ji.appendChild(jn);
  } else {
    const jn = document.createElement('span'); jn.className = 'jk-name'; jn.textContent = '--';
    ji.appendChild(jn);
  }
  document.getElementById('wallInfo').textContent='牌墙 '+state.wallLeft;
  const qn = state.quanNo || 1;
  const lz = state.lianZhuang ? (' 连' + state.lianZhuang) : '';
  document.getElementById('roundInfo').textContent =
    `第${qn}圈·第${state.roundNo}局${lz} 庄:${nameOf(state.dealer)}`;

  // 面板路由
  setOverlay('waitingPanel', state.phase==='waiting');
  setOverlay('swapPanel', state.phase==='swap');
  if(state.phase==='ended'){ setOverlay('resultModal', true); showResult(); }
  else setOverlay('resultModal', false);

  if(state.phase==='waiting'){ renderWaiting(); return; }
  if(state.phase==='swap'){ renderSwap(); }

  renderTable();
  renderActions();
  renderLog();
}
function setOverlay(id, show){ const el=document.getElementById(id); if(show) el.classList.add('show'); else el.classList.remove('show'); }

// ---------- 等待面板 ----------
function renderWaiting(){
  document.getElementById('waitRoom').textContent = state.roomId;
  const list = document.getElementById('playerList'); list.innerHTML='';
  state.players.forEach(p=>{
    const d=document.createElement('div'); d.className='pl-item';
    d.textContent = `${p.name}${p.isHost?'(房主)':''}${p.isBot?'(机器人)':''}${p.connected?'':' (离线)'}`;
    if(p.isBot) d.style.opacity='.75';
    list.appendChild(d);
  });
  const startBtn=document.getElementById('startBtn');
  const hint=document.getElementById('waitHint');
  const botBox=document.getElementById('botControls');
  const botCount = state.players.filter(p=>p.isBot).length;
  if(isHost()){
    startBtn.style.display='';
    botBox.style.display='flex';
    document.getElementById('addBotBtn').disabled = state.players.length>=4;
    document.getElementById('removeBotBtn').disabled = botCount===0;
    hint.textContent = state.players.length<4 ? `当前${state.players.length}人, 可加机器人补位或等朋友` : '点击开始游戏';
    startBtn.disabled = state.players.length<4;
  } else {
    startBtn.style.display='none';
    botBox.style.display='none';
    hint.textContent='等待房主开始游戏…';
  }
}

// ---------- 换牌面板 ----------
function suitLabel(s){ return {m:'万', s:'条', p:'筒'}[s] || s; }

// 骰子：3x3 点阵，1-6 点按真实骰面排布
const DICE_PIPS = {
  1:[[1,1]],
  2:[[0,0],[2,2]],
  3:[[0,0],[1,1],[2,2]],
  4:[[0,0],[0,2],[2,0],[2,2]],
  5:[[0,0],[0,2],[1,1],[2,0],[2,2]],
  6:[[0,0],[0,1],[0,2],[2,0],[2,1],[2,2]],
};
let diePlayedId = -1, dieTimers = [];
function dieEl(n, rolling){
  const d=document.createElement('div');
  d.className='die'+(rolling?' rolling':'');
  DICE_PIPS[n].forEach(([r,c])=>{
    const i=document.createElement('i');
    i.style.gridArea=`${r+1}/${c+1}`;
    i.className='on';
    d.appendChild(i);
  });
  return d;
}
function paintDice(box, a, b, rolling){
  box.innerHTML='';
  box.appendChild(dieEl(a, rolling));
  box.appendChild(dieEl(b, rolling));
}
// 摇骰动画：滚 0.9 秒左右再定格，顺便把"这次给谁"讲清楚
function playSwapDice(sw){
  const box=document.getElementById('swapDice');
  const txt=document.getElementById('swapDiceText');
  if(!box || !txt) return;
  const fin = (Array.isArray(sw.dice) && sw.dice.length===2) ? sw.dice : [3,3];
  if(diePlayedId===sw.id){ paintDice(box, fin[0], fin[1], false); return; }
  diePlayedId=sw.id;
  dieTimers.forEach(clearTimeout); dieTimers=[];
  box.classList.add('rolling');
  txt.className='swap-dice-text rolling';
  txt.textContent='摇骰子…';
  let n=0;
  const tick=()=>{
    paintDice(box, 1+Math.floor(Math.random()*6), 1+Math.floor(Math.random()*6), true);
    if(++n<9) dieTimers.push(setTimeout(tick, 95+n*10));
    else {
      paintDice(box, fin[0], fin[1], false);
      box.classList.remove('rolling');
      txt.className='swap-dice-text done';
      txt.innerHTML=`摇出 <b>${fin[0]} + ${fin[1]} = ${sw.diceSum}</b> 点 · <b>${sw.dirText||''}</b>`;
      if(sw.giveTo){
        const line=document.createElement('div');
        line.className='swap-give';
        line.appendChild(document.createTextNode('你 → '));
        const rel=document.createElement('b'); rel.textContent=sw.giveTo.rel; line.appendChild(rel);
        if(sw.giveTo.name) line.appendChild(document.createTextNode(`（${sw.giveTo.name}）`));
        txt.appendChild(line);
      }
    }
  };
  tick();
}

function renderSwap(){
  const desc=document.getElementById('swapDesc');
  const suitsBox=document.getElementById('swapSuits');
  const selectBox=document.getElementById('swapSelect');
  const choicesBox=document.getElementById('swapChoices');
  const wait=document.getElementById('swapWait');
  suitsBox.innerHTML=''; selectBox.innerHTML=''; choicesBox.innerHTML='';
  if(!state.swap){ desc.textContent='准备换牌…'; wait.textContent=''; return; }
  // 摇骰动画（每个 swap.id 只播一次；重摇会换 id，重新播）
  playSwapDice(state.swap);
  // 服务端每次换牌/重摇都会换 id：id 变了说明是新的一轮，必须清掉上一轮的本地状态
  if (curSwapId !== state.swap.id) {
    curSwapId = state.swap.id; swapSuit = null; swapSelection = []; swapSubmitted = false; swapSubmitAt = 0;
  }
  const canChoose = (state.actions||[]).includes('swap:chooseSuit');
  // 服务端已记录 = 真提交成功；本地 pending 超过 3 秒仍无回执，视为提交失败，允许重试
  const confirmed = !!state.swap.yourChoice;
  if (!confirmed && swapSubmitted && swapSubmitAt && Date.now() - swapSubmitAt > 3000) swapSubmitted = false;
  const submitted = confirmed || swapSubmitted;
  const picked = swapSuit || state.swap.yourChoice;

  if(!picked){
    desc.textContent = '每人从手里挑 3 张同花色换出（庄家 17 张、其余三家 16 张）；若四家给出花色一致则重摇。';
    if(canChoose){
      wait.textContent='第一步：选择要换出的花色（不足 3 张的花色不可选）';
      const selfHand = (state.players.find(p=>p.seat===state.selfSeat)||{}).hand || [];
      [['m','万'],['s','条'],['p','筒']].forEach(([s,label])=>{
        const cnt = selfHand.filter(t=>suitClass(t)===s).length;
        const b=document.createElement('button'); b.className='suit-btn';
        b.textContent=`${label}（${cnt}）`;
        if(cnt<3){ b.disabled=true; b.title='该花色不足 3 张'; b.classList.add('disabled'); }
        else b.onclick=()=>{ swapSuit=s; swapSelection=[]; renderSwap(); };
        suitsBox.appendChild(b);
      });
    } else {
      wait.textContent='等待其他玩家选择花色…';
    }
  } else {
    // 第二步：从所选花色里手动挑 3 张
    const self = state.players.find(p=>p.seat===state.selfSeat);
    const suit = picked;
    const suitTiles = (self.hand||[]).filter(t=>suitClass(t)===suit);
    // 选择用下标：手里有两张一样的（3 7 7 8 万），点其中一张只圈那一张，不会两张一起圈
    swapSelection = swapSelection.filter(i=>i>=0 && i<suitTiles.length);
    if(swapSelection.length===0 && state.swap.presetSelect){
      const used=new Set();
      state.swap.presetSelect.forEach(v=>{
        const i=suitTiles.findIndex((t,idx)=>t===v && !used.has(idx));
        if(i>=0){ used.add(i); swapSelection.push(i); }
      });
    }
    desc.textContent = submitted
      ? `已提交「${suitLabel(suit)}」的 3 张，等待其他玩家…`
      : `第二步：从你的「${suitLabel(suit)}」中点击挑选 3 张换出（已选 ${swapSelection.length}/3）。金可随同花色一起换出。`;
    wait.textContent='';
    const wrap=document.createElement('div'); wrap.className='swap-tiles';
    suitTiles.forEach((t,i)=>{
      const te=tileEl(t,{joker:t===state.joker});
      if(swapSelection.includes(i)) te.classList.add('selected');
      te.onclick=()=>{
        if(submitted) return;
        if(swapSelection.includes(i)) swapSelection=swapSelection.filter(x=>x!==i);
        else if(swapSelection.length<3) swapSelection.push(i);
        renderSwap();
      };
      wrap.appendChild(te);
    });
    selectBox.appendChild(wrap);
    if(!submitted){
      const back=document.createElement('button');
      back.className='suit-btn back';
      back.textContent='← 换一个花色';
      back.onclick=()=>{ swapSuit=null; swapSelection=[]; renderSwap(); };
      selectBox.appendChild(back);
    }
    const info=document.createElement('div'); info.className='swap-sel-info';
    info.textContent = submitted
      ? '已提交，等待其他玩家…'
      : (swapSelection.length===3
          ? (swapSubmitAt && Date.now()-swapSubmitAt>3000 ? '提交没生效，请再点一次「确认换这 3 张」' : '已选满 3 张，可确认换牌')
          : `还差 ${3-swapSelection.length} 张（该花色共 ${suitTiles.length} 张可选）`);
    selectBox.appendChild(info);
    if(!submitted && swapSelection.length===3){
      const ok=document.createElement('button'); ok.className='suit-btn confirm';
      ok.textContent='确认换这 3 张';
      ok.onclick=()=>{
        swapSubmitted=true; swapSubmitAt=Date.now();
        send({t:'swap',suit:suit,tiles:swapSelection.map(i=>suitTiles[i])});
        renderSwap();
        setTimeout(()=>{ if(!state||!state.swap||state.swap.id!==curSwapId) return; renderSwap(); }, 3200);
      };
      selectBox.appendChild(ok);
    }
  }
  // 各家已选状态（只显示"选好没"，不显示选了哪门花色 —— 免得后选的人针对性避开）
  const rows = state.players.filter(p=>p.seat!=null).map(p=>{
    const chosen = !!(state.swap.chosen && state.swap.chosen[p.seat]);
    const mine = p.seat===state.selfSeat;
    return `<div class="prow${chosen?' done':''}"><span>${p.name}</span><span>${chosen?(mine?'已选好 · 等其他人':'已选好'):'考虑中'}</span></div>`;
  }).join('');
  choicesBox.innerHTML = rows;
}

// ---------- 牌面渲染（真实麻将牌样式） ----------
// 万(0-8)：数字+萬；条(9-17)：竹节(一条=麻雀)；筒(18-26)：环形圆点；花(27+)：单字
const CN_NUM = ['一','二','三','四','五','六','七','八','九'];
// 筒：每个圆点=外环+留白+中心点（真实筒子花纹）；一筒=华丽大圆饼
const C_GREEN = '#1e7a3c', C_BLUE = '#1b5fa8', C_RED = '#b3202a', C_BLACK = '#1d1d1d';
function dotRing(x, y, r, color) {
  return `<circle cx="${x}" cy="${y}" r="${r}" fill="${color}"/>` +
    `<circle cx="${x}" cy="${y}" r="${(r * 0.6).toFixed(2)}" fill="#f7f4ea"/>` +
    `<circle cx="${x}" cy="${y}" r="${(r * 0.3).toFixed(2)}" fill="${color}"/>`;
}
function dotOne() {
  return `<circle cx="15" cy="20" r="9" fill="${C_GREEN}"/>` +
    `<circle cx="15" cy="20" r="7.2" fill="#f7f4ea"/>` +
    `<circle cx="15" cy="20" r="5.3" fill="${C_GREEN}"/>` +
    `<circle cx="15" cy="20" r="3.7" fill="#f7f4ea"/>` +
    `<circle cx="15" cy="20" r="2.4" fill="${C_RED}"/>`;
}
// [x, y, 颜色]；2~9 标准排布（viewBox 30x40），配色按参考图（绿/黑/红）
const PIN_POS = {
  2: [[15, 12, C_GREEN], [15, 28, C_GREEN]],
  3: [[11, 12, C_GREEN], [15, 20, C_RED], [19, 28, C_BLACK]],
  4: [[11, 13, C_GREEN], [19, 13, C_BLACK], [11, 27, C_BLACK], [19, 27, C_GREEN]],
  5: [[11, 12, C_GREEN], [19, 12, C_BLACK], [15, 20, C_RED], [11, 28, C_BLACK], [19, 28, C_GREEN]],
  6: [[10, 9, C_GREEN], [20, 9, C_GREEN], [10, 21, C_RED], [20, 21, C_RED], [10, 29, C_RED], [20, 29, C_RED]],
  7: [[21, 9, C_GREEN], [15, 14, C_GREEN], [9, 19, C_GREEN], [11, 26, C_RED], [19, 26, C_RED], [11, 34, C_RED], [19, 34, C_RED]],
  8: [[10, 8, C_BLACK], [20, 8, C_BLACK], [10, 16, C_BLACK], [20, 16, C_BLACK], [10, 24, C_BLACK], [20, 24, C_BLACK], [10, 32, C_BLACK], [20, 32, C_BLACK]],
  9: [[9, 10, C_BLACK], [15, 10, C_BLACK], [21, 10, C_BLACK], [9, 20, C_RED], [15, 20, C_RED], [21, 20, C_RED], [9, 30, C_GREEN], [15, 30, C_GREEN], [21, 30, C_GREEN]],
};
function dotsSVG(n) {
  if (n === 1) return dotOne();
  const pos = PIN_POS[n] || [];
  const r = n === 2 ? 4.6 : n === 3 ? 4 : n === 7 ? 3.3 : n === 8 ? 3.2 : 3.5;
  return pos.map(([x, y, c]) => dotRing(x, y, r, c)).join('');
}
// 条(竹节)：竖向圆角竹节 + 上下节纹；2~9 排布各不相同
// 2=上下两根；3=上1红+下2绿；4=2x2；5=四角+中红；6=3x2；7=上1红+2x3绿；8=W/M斜杠造型；9=3x3中间列红
const SOU_POS = {
  2: [[15, 12, C_GREEN], [15, 28, C_GREEN]],
  3: [[15, 12, C_RED], [11, 26, C_GREEN], [19, 26, C_GREEN]],
  4: [[11, 13, C_GREEN], [19, 13, C_GREEN], [11, 27, C_GREEN], [19, 27, C_GREEN]],
  5: [[10, 12, C_GREEN], [20, 12, C_GREEN], [15, 20, C_RED], [10, 28, C_GREEN], [20, 28, C_GREEN]],
  6: [[9, 13, C_GREEN], [15, 13, C_GREEN], [21, 13, C_GREEN], [9, 27, C_GREEN], [15, 27, C_GREEN], [21, 27, C_GREEN]],
  7: [[15, 8, C_RED], [9, 19, C_GREEN], [15, 19, C_GREEN], [21, 19, C_GREEN], [9, 31, C_GREEN], [15, 31, C_GREEN], [21, 31, C_GREEN]],
  9: [[9, 9, C_GREEN], [9, 20, C_GREEN], [9, 31, C_GREEN], [15, 9, C_RED], [15, 20, C_RED], [15, 31, C_RED], [21, 9, C_GREEN], [21, 20, C_GREEN], [21, 31, C_GREEN]],
};
function bambooStick(x, y, color, h = 13) {
  const w = 3.6, l = (x - w / 2).toFixed(2);
  return `<rect x="${l}" y="${(y - h / 2).toFixed(2)}" width="${w}" height="${h}" rx="${w / 2}" fill="${color}"/>` +
    `<rect x="${l}" y="${(y - h / 2 + 2.6).toFixed(2)}" width="${w}" height="1.2" fill="rgba(255,255,255,.55)"/>` +
    `<rect x="${l}" y="${(y + h / 2 - 3.8).toFixed(2)}" width="${w}" height="1.2" fill="rgba(255,255,255,.55)"/>`;
}
// 斜向竹节（用于八条交叉造型）
function diagBamboo(x1, y1, x2, y2, color) {
  const cx = (x1 + x2) / 2, cy = (y1 + y2) / 2;
  const len = Math.hypot(x2 - x1, y2 - y1);
  const ang = Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI;
  return `<rect x="${(cx - len / 2).toFixed(2)}" y="${(cy - 1.9).toFixed(2)}" width="${len.toFixed(2)}" height="3.8" rx="1.9" fill="${color}" transform="rotate(${ang.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)})"/>` +
    `<rect x="${(cx - len / 2).toFixed(2)}" y="${(cy - 0.4).toFixed(2)}" width="${len.toFixed(2)}" height="0.8" fill="rgba(255,255,255,.5)" transform="rotate(${ang.toFixed(2)} ${cx.toFixed(2)} ${cy.toFixed(2)})"/>`;
}
// 八条：上组「W」、下组「M」，粗绿笔画 + 白槽的连续折线（贴近真实麻将蝴蝶造型）
function souEightSVG() {
  const c = C_GREEN, sw = 4.8;
  const draw = (pts) => {
    const d = pts.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join(' ');
    return `<path d="${d}" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${d}" fill="none" stroke="#dcecda" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`;
  };
  let s = '';
  // 上组 W：两端高竖节 + 中间一凸、两侧下凹
  s += draw([[6, 17], [6, 5], [10.5, 12], [15, 5.5], [19.5, 12], [24, 5], [24, 17]]);
  // 下组 M：上组垂直镜像（两端竖节低、中间一凹、两侧上凸）
  s += draw([[6, 23], [6, 35], [10.5, 28], [15, 34.5], [19.5, 28], [24, 35], [24, 23]]);
  return s;
}
function bambooSVG(n) {
  if (n === 8) return souEightSVG();
  const h = (n === 9) ? 11 : 13; // 九条 3x3，竖节略短以免上下相叠
  return (SOU_POS[n] || SOU_POS[3]).map(([x, y, c]) => bambooStick(x, y, c, h)).join('');
}
// 一条 = 一只麻雀（区别于其它竹节条）
function birdSVG() {
  return `<polygon points="8,24 1,20 5,23 2,27" fill="#1e7a3c"/>` +
    `<ellipse cx="15" cy="22" rx="7.5" ry="5" fill="#2f9e57"/>` +
    `<ellipse cx="14" cy="21.5" rx="6" ry="3.4" fill="#256f3e"/>` +
    `<circle cx="22" cy="15" r="4.2" fill="#2f9e57"/>` +
    `<path d="M20 12 l1.4 -4 l1.6 3.4" fill="#1e7a3c"/>` +
    `<polygon points="25.6,14 29.5,15.4 25.6,16.6" fill="#e8a020"/>` +
    `<circle cx="22.6" cy="14" r="0.9" fill="#08310f"/>` +
    `<rect x="12.4" y="26.5" width="1.1" height="5.5" fill="#8a5a1a"/>` +
    `<rect x="15.8" y="26.5" width="1.1" height="5.5" fill="#8a5a1a"/>`;
}
// 字牌：东南西北墨色、中红、发(發)绿、白板=双线方框
function honorSVG(name) {
  const INK = '#16202a';
  if (name === '白') {
    return `<rect x="5.6" y="7.6" width="18.8" height="24.8" rx="1.4" fill="none" stroke="${INK}" stroke-width="2.2"/>` +
      `<rect x="9" y="11" width="12" height="18" rx="0.6" fill="none" stroke="${INK}" stroke-width="1.3"/>`;
  }
  const color = name === '中' ? C_RED : name === '发' ? C_GREEN : INK;
  const ch = name === '发' ? '發' : name;
  return `<text x="15" y="27.5" font-size="18.5" text-anchor="middle" fill="${color}" font-weight="700" font-family="'KaiTi','STKaiti','Kaiti SC','Songti SC',serif">${ch}</text>`;
}
function tileFaceSVG(idx) {
  let inner = '';
  if (idx < 9) { // 万：上数字(黑)、下萬(红)
    const n = idx + 1;
    inner = `<text x="15" y="16.5" font-size="14" text-anchor="middle" fill="${C_BLACK}" font-weight="700" font-family="'KaiTi','STKaiti','Kaiti SC',serif">${CN_NUM[n - 1]}</text>` +
            `<text x="15" y="34" font-size="14.5" text-anchor="middle" fill="${C_RED}" font-weight="700" font-family="'KaiTi','STKaiti','Kaiti SC',serif">萬</text>`;
  } else if (idx < 18) { // 条
    inner = (idx === 9) ? birdSVG() : bambooSVG(idx - 9 + 1); // 一条=小鸟，其余=竹节
  } else if (idx < 27) { // 筒
    inner = dotsSVG(idx - 18 + 1);
  } else { // 花(27-34 四季四君子，紫)；字牌(35-62 东南西北中发白)
    const name = TILE_NAMES[idx];
    if ((idx - 27) < 8) {
      inner = `<text x="15" y="26" font-size="15" text-anchor="middle" fill="#7b2fb0" font-weight="700" font-family="'KaiTi','STKaiti','Kaiti SC',serif">${name}</text>`;
    } else {
      inner = honorSVG(name);
    }
  }
  return `<svg viewBox="0 0 30 40" width="100%" height="100%" preserveAspectRatio="xMidYMid meet">${inner}</svg>`;
}

// ---------- 牌桌 ----------
// 手牌排序：金永远最前，再按花色(万<条<筒)从小到大；摸进来的牌自动归类摆好
function sortHand(hand, joker) {
  const sc = t => (t === joker ? -1 : (t < 9 ? 0 : t < 18 ? 1 : 2));
  return hand.slice().sort((a, b) => (sc(a) - sc(b)) || (a - b));
}
function tileEl(idx, {small = false, back = false, joker = false} = {}) {
  const d = document.createElement('div');
  d.className = 'tile' + (small ? ' small' : '') + (back ? ' back' : '');
  d.dataset.tile = String(idx);
  if (!back) {
    const isJ = joker || (state && idx === state.joker);
    if (isJ) d.classList.add('joker');      // 金：保留原牌面 + 黄底 + 角标“金”，让你看清原本是几
    d.classList.add(suitClass(idx));
    d.innerHTML = tileFaceSVG(idx);
  }
  return d;
}

// 副露渲染：金坎在"金位"留空框（如 七筒 [金] 九筒）
function meldEl(m, small){
  const hold=document.createElement('div'); hold.className='meld-group';
  const wrap=document.createElement('div');
  wrap.className='melds' + (m.type==='jinkan' ? ' jinkan-meld' : '');
  hold.appendChild(wrap);
  (m.tiles||[]).forEach(t=>{
    if(t==='J'){
      const g=document.createElement('div');
      g.className='tile'+(small?' small':'')+' jin-gap';
      g.title='金位（等摸金补位）';
      g.textContent='金';
      wrap.appendChild(g);
    } else {
      wrap.appendChild(tileEl(t,{small:!!small,joker:t===state.joker}));
    }
  });
  return hold;
}

function renderTable(){
  const players = state.players;
  const self = players.find(p=>p.seat===state.selfSeat);
  const order = [(state.selfSeat+1)%4, (state.selfSeat+2)%4, (state.selfSeat+3)%4];
  const slots = ['.opp-right','.opp-top','.opp-left'];
  for(let k=0;k<3;k++){
    const p = players.find(x=>x.seat===order[k]);
    const el = document.querySelector(slots[k]);
    if(!p){ el.innerHTML=''; continue; }
    const pinfo = el.querySelector('.pinfo');
    const isDealer = p.seat === state.dealer;
    const flags = [];
    if(p.jinKan) flags.push('<span class="jinkan-flag">金坎</span>');
    if(p.declaredTing) flags.push('<span class="ting-flag">听</span>');
    const badges = (isDealer ? '<span class="dealer">庄</span>' : '') +
      (p.flowerCount ? `<span class="flower">花${p.flowerCount}</span>` : '') +
      scoreChip(p.score);
    pinfo.innerHTML = `<span class="${p.isCurrent?'cur':''} ${p.connected?'':'off'}">${p.name}${p.isHost?'(房)':''}${p.isCurrent?' ◀':''}</span> ${badges} ${flags.join('')} <span style="opacity:.7">${p.handCount}张</span>`;
    // 吃碰区（阴影盒内）：暗牌(手牌背面) + 已亮明子
    const backWrap=document.createElement('div'); backWrap.className='melds';
    for(let i=0;i<p.handCount;i++) backWrap.appendChild(tileEl(0,{small:true,back:true}));
    const meldsWrap=el.querySelector('.melds'); meldsWrap.innerHTML='';
    // 副露排在暗牌前面：盒子被裁切时也不会把亮出的牌吃掉
    p.melds.forEach(m=>{ meldsWrap.appendChild(meldEl(m,true)); });
    meldsWrap.appendChild(backWrap);
    // 打出的牌：移到阴影区外
    const discBox=el.querySelector('.opp-disc'); discBox.innerHTML='';
    const dl=document.createElement('div'); dl.className='disc-label'; dl.textContent='出牌'; discBox.appendChild(dl);
    const dt=document.createElement('div'); dt.className='disc-tiles';
    p.discards.slice(-12).forEach(t=>dt.appendChild(tileEl(t,{small:true,joker:t===state.joker})));
    discBox.appendChild(dt);
  }

  const ld=document.getElementById('lastDiscard'); ld.innerHTML='';
  if(state.lastDiscard){
    const t=state.lastDiscard.tile;
    const td=tileEl(t); td.style.width='38px'; td.style.height='50px';
    ld.appendChild(td);
  }
  const hint=document.getElementById('turnHint');
  const isQG = !!(state.pending && state.pending.kind==='qianggang');
  const isQJWin = !!(state.pending && state.pending.qiangjin && state.pending.kind!=='qianggang');
  const selfInPending = !!(state.pending && (state.pending.seats||[]).includes(state.selfSeat));
  hint.textContent = state.phase!=='playing' ? ''
    : isQG
      ? (state.pending.by===state.selfSeat ? '等别家决定抢不抢杠…' : '有人加杠，等抢杠决定…')
      : (isQJWin && state.pending.by===state.selfSeat && selfInPending
          ? '庄家首张已打出 · 你也可以抢金（优先级最低，闲家先抢）'
          : isQJWin && selfInPending
            ? '开金首张已打出 · 拿公示金能胡就抢'
            : (self.jinKan ? '' : (self.isCurrent?'轮到你出牌':'等待其他玩家…')));
  const flagEl=document.getElementById('flagInfo');
  const jkP = players.find(p=>p.jinKan);
  flagEl.textContent = '';
  // 金坎横幅统一放在手牌上方（中心区会被对家牌盒压住）
  const jkTip = document.getElementById('jinkanTip');
  if(jkTip){
    if(jkP && jkP.seat === self.seat){
      jkTip.hidden=false;
      jkTip.textContent='金坎已宣告 · 手牌全部盖倒 · 只摸牌不换牌 · 摸到金即胡';
    } else if(jkP){
      jkTip.hidden=false;
      jkTip.textContent=`${jkP.name} 金坎中 · 不吃不碰不杠，只等摸金自摸`;
    } else {
      jkTip.hidden=true;
    }
  }

  const handEl=document.getElementById('hand'); handEl.innerHTML='';
  if(self.jinKan){
    // 金坎：手牌全部盖倒（连自己都不看牌），只等摸金
    const n = self.hand ? self.hand.length : (self.handCount || 0);
    for(let i=0;i<n;i++) handEl.appendChild(tileEl(0,{back:true}));
  } else if(self.hand){
    // 刚摸上来的那张单独摆在最右边（不参与排序），方便一眼认出；
    // 打掉别的牌、轮次走过后就不再是"刚摸的"，自然归位到排序里
    const drawn = (typeof self.drawn === 'number' && self.drawn >= 0 &&
      self.hand.includes(self.drawn)) ? self.drawn : null;
    const rest = self.hand.slice();
    if(drawn != null){ const i = rest.lastIndexOf(drawn); if(i >= 0) rest.splice(i,1); }
    const ordered = sortHand(rest, state.joker);
    if(drawn != null) ordered.push(drawn);
    ordered.forEach((t,i)=>{
      const te=tileEl(t,{joker:t===state.joker});
      if(drawn != null && i===ordered.length-1) te.classList.add('just-drawn');
      if(state.actions.includes('discard')) te.onclick=()=>send({t:'discard',tile:t});
      handEl.appendChild(te);
    });
    // 手机上牌多会横滑：摸牌后自动滚到最右，保证刚摸的那张看得见
    if(drawn != null && handEl.scrollWidth > handEl.clientWidth + 2){
      handEl.scrollLeft = handEl.scrollWidth;
    }
  }
  const sm=document.getElementById('selfMelds'); sm.innerHTML='';
  // 金坎组用正常尺寸，亮在台面上让人一眼看到
  self.melds.forEach(m=>{ const g=meldEl(m, m.type!=='jinkan'); g.style.marginRight='8px'; sm.appendChild(g); });
  const si=document.getElementById('selfInfo');
  if(si){
    const isDealer = self.seat === state.dealer;
    si.innerHTML = `<span class="${self.isCurrent?'cur':''}">${self.name}</span>` +
      (isDealer?'<span class="dealer">庄</span>':'') +
      (self.flowerCount?`<span class="flower">花${self.flowerCount}</span>`:'') +
      (self.jinKan?'<span class="jinkan-flag">金坎</span>':'') +
      (self.declaredTing?'<span class="ting-flag">已听</span>':'') +
      scoreChip(self.score) +
      `<span style="opacity:.7">${self.handCount!=null?self.handCount:(self.hand?self.hand.length:'?')}张</span>`;
  }
  // 自己打过的牌：阴影区外
  const sd=document.getElementById('selfDisc'); sd.innerHTML='';
  if(self.discards && self.discards.length){
    const sdl=document.createElement('span'); sdl.className='disc-label'; sdl.textContent='我打过的牌'; sd.appendChild(sdl);
    self.discards.slice(-14).forEach(t=>sd.appendChild(tileEl(t,{small:true,joker:t===state.joker})));
  }
}

// ---------- 动作 ----------
function renderActions(){
  const box=document.getElementById('actions'); box.innerHTML='';
  const acts=state.actions||[];
  const self = state.players.find(p=>p.seat===state.selfSeat);

  if(acts.includes('discard') && self && self.isCurrent){
    const tip=document.createElement('span'); tip.textContent='点击手牌打出'; tip.style.alignSelf='center'; tip.style.opacity='.8'; box.appendChild(tip);
  }
  // 碰/杠优先：自己已经申请吃，正在等碰家表态
  if(state.pending && state.pending.chiWait === state.selfSeat){
    const tip=document.createElement('span'); tip.className='act-tip';
    const qjw = (state.pending.qjWait||[]).filter(s=>s!==state.selfSeat).map(s=>nameOf(s));
    const who = qjw.length ? qjw : (state.pending.pengWait||[]).map(s=>nameOf(s));
    const why = qjw.length ? '抢不抢金（抢金优先）' : '碰不碰（碰优先）';
    tip.textContent = who.length ? `你已申请吃，等 ${who.join('、')} 决定${why}…` : '你已申请吃，等其他人表态…';
    box.appendChild(tip);
  }
  // 胡 > 碰/杠：自己先点了碰/杠，也要等能胡的家明确放弃才生效
  if(state.pending && state.pending.pengIntent === state.selfSeat){
    const who = (state.pending.huWait||[]).map(s=>nameOf(s)).join('、');
    const tip=document.createElement('span'); tip.className='act-tip act-warn';
    const why = state.pending.qiangjin ? '抢不抢金' : '胡不胡';
    tip.textContent = who
      ? `你已申请碰/杠，等 ${who} 先决定${why}（对方要了就没你的份）…`
      : '你已申请碰/杠，等其他人表态…';
    box.appendChild(tip);
  }
  // 抢金优先：抢金窗口里，别家的吃/碰/杠必须等能抢金的家点过才生效
  if(state.pending && state.pending.qiangjin && state.pending.kind!=='qianggang'){
    const qjWait = state.pending.qjWait||[];
    const iAmQj = !!(self && self.huInfo && self.huInfo.kind==='qiangjin');
    const hasCPG = acts.includes('peng') || acts.includes('gang') || acts.some(a=>a&&a.act==='chi');
    if(iAmQj && qjWait.includes(state.selfSeat)){
      const others = qjWait.filter(s=>s!==state.selfSeat);
      const tip=document.createElement('span'); tip.className='act-tip act-hu-tip';
      tip.textContent = others.length
        ? `抢金窗口：${others.map(s=>nameOf(s)).join('、')} 也能抢；全部点过后别家才能吃碰`
        : '抢金窗口：点「过」就放弃抢金，别家才能吃碰';
      box.appendChild(tip);
    } else if(hasCPG && qjWait.length){
      const tip=document.createElement('span'); tip.className='act-tip act-warn';
      tip.textContent = `抢金优先：等 ${qjWait.map(s=>nameOf(s)).join('、')} 决定抢不抢金，你的吃/碰/杠才生效`;
      box.appendChild(tip);
    }
  }
  const huBtn = acts.includes('hu');
  const isSelfHu = !!state.selfCanHu;
  const isQG = !!(state.pending && state.pending.kind==='qianggang');
  // 这手胡的是什么（对对胡 / 金雀 / 清一色…）：按钮上直接写明，不会糊里糊涂点碰把胡丢了
  const huInfo = self && self.huInfo;
  const isQJ = !!(huInfo && huInfo.kind==='qiangjin');
  const huLabel = huInfo && huInfo.labels && huInfo.labels.length ? huInfo.labels.join(' · ') : '';
  if(huBtn) addBtn(box,(isQG?'抢杠胡':(isQJ?'抢金':(isSelfHu?'自摸':'胡'))) + (huLabel?(' · '+huLabel):''),'act-hu',()=>{
    if(isQG) send({t:'claim',action:'hu'});
    else if(isSelfHu) send({t:'hu'});
    else send({t:'claim',action:'hu',tile:state.lastDiscard?state.lastDiscard.tile:null});
  });
  if(isQJ){
    const tip=document.createElement('span'); tip.className='act-tip act-hu-tip';
    const qjTile = huInfo.qiangjinTile!=null ? (TILE_NAMES[huInfo.qiangjinTile]||'') : '';
    // 庄家打完首张后自己也能抢（手牌同样 16 张），只是优先级最低
    const selfDealer = !!(state.pending && state.pending.by === state.selfSeat);
    tip.textContent = selfDealer
      ? `抢金：你打完首张后手牌也剩 16 张，把开局公示金${qjTile?('（'+qjTile+'）'):''}拿进来同样能胡；但优先级最低，闲家没人抢才轮到你` + (huLabel?`（${huLabel}）`:'')
      : `抢金：把开局翻出的公示金${qjTile?('（'+qjTile+'）'):''}拿进手牌就能胡` + (huLabel?`（${huLabel}）`:'');
    box.appendChild(tip);
  } else if(huBtn && huLabel){
    const tip=document.createElement('span'); tip.className='act-tip act-hu-tip';
    tip.textContent = isQG ? `这手是 ${huLabel}，可以抢杠胡` : (isSelfHu ? `现在就能胡：${huLabel}` : `这手是 ${huLabel}，可以点炮胡`);
    box.appendChild(tip);
  }
  // 有人抢着碰/杠，但胡优先：提醒胡家别慌，点「胡」就是你的
  if(huBtn && state.pending && state.pending.pengIntent != null && state.pending.pengIntent !== state.selfSeat){
    const tip=document.createElement('span'); tip.className='act-tip act-hu-tip';
    tip.textContent = state.pending.qiangjin
      ? `${nameOf(state.pending.pengIntent)} 已经想碰/杠，但抢金优先：点「抢金」就归你，点「过」才轮到他`
      : `${nameOf(state.pending.pengIntent)} 已经想碰/杠，但胡优先：点「胡」就归你，点「过」才轮到他`;
    box.appendChild(tip);
  }
  // 抢杠：别人加杠，只有"有奖励的大牌"能抢；小胡不能抢
  if(isQG){
    const tip=document.createElement('span'); tip.className='act-tip';
    if(state.pending.by===state.selfSeat){
      tip.textContent=`你加杠 ${TILE_NAMES[state.pending.tile]||''}，等别家决定抢不抢杠…`;
    } else if((state.pending.seats||[]).includes(state.selfSeat)){
      tip.textContent='别家加杠，你这手是有奖励的大牌，可以抢杠胡';
    } else {
      tip.textContent=`${nameOf(state.pending.by)} 加杠 ${TILE_NAMES[state.pending.tile]||''}，等可抢杠的家表态…`;
    }
    box.appendChild(tip);
  }
  // 小胡不能点炮：这手牌虽然能凑成胡，但只是普通小胡，只能自摸
  if(state.pending && (state.pending.xiaoHu||[]).includes(state.selfSeat)){
    const tip=document.createElement('span'); tip.className='act-tip';
    tip.textContent='这手是小胡（普通牌型），只能自摸，别人打的牌不能点炮';
    box.appendChild(tip);
  }
  // 已听金雀：提醒别手快——碰/吃会把这手金雀拆掉
  const jqTiles = (self && self.jinQueTiles) || [];
  if(jqTiles.length){
    const canP = acts.includes('peng') || acts.includes('gang') || acts.some(a=>a&&a.act==='chi');
    const names = jqTiles.map(t=>TILE_NAMES[t]||'').join(' / ');
    const tip=document.createElement('span'); tip.className='act-tip act-warn';
    tip.textContent = canP
      ? `⚠ 你已听金雀（摸到 ${names} 就胡），碰/吃会拆掉这手金雀`
      : `你已听金雀：摸到 ${names} 就胡`;
    box.appendChild(tip);
  }
  const chiAct = acts.find(a=>a && a.act==='chi');
  if(chiAct && chiAct.combos && chiAct.combos.length){
    if(chiAct.combos.length===1){
      const c=chiAct.combos[0];
      addBtn(box,'吃','act-chi',()=>send({t:'claim',action:'chi',payload:{combo:c}}));
    } else {
      chiAct.combos.forEach(c=>{
        const lab='吃 '+c.map(t=>TILE_NAMES[t]).join('');
        addBtn(box,lab,'act-chi',()=>send({t:'claim',action:'chi',payload:{combo:c}}));
      });
    }
  }
  if(acts.includes('peng')) addBtn(box,'碰','act-peng',()=>send({t:'claim',action:'peng',tile:state.lastDiscard.tile}));
  if(acts.includes('gang')) addBtn(box,'杠','act-gang',()=>send({t:'claim',action:'gang',tile:state.lastDiscard.tile}));
  if(acts.includes('jinkan')) addBtn(box,'金坎','act-jinkan',()=>send({t:'jinkan'}));
  const gangActs = acts.filter(a=>typeof a==='string' && (a.startsWith('bugang:')||a.startsWith('angang:')));
  if(acts.includes('ting')){
    const tip=document.createElement('span'); tip.className='act-tip';
    // 报听和加杠是两条并列的路：先杠可以多补一张，杠完仍然能报听
    tip.textContent = gangActs.length
      ? '你在做清一色/混一色：可以先加杠/暗杠补一张，再宣告听牌'
      : '你在做清一色/混一色（吃碰已满 3 手），可以宣告听牌';
    box.appendChild(tip);
    addBtn(box,'宣告听牌','act-ting',()=>send({t:'ting'}));
  }
  if(acts.includes('pass')) addBtn(box,'过','act-pass',()=>send({t:'claim',action:'pass',tile:state.lastDiscard?state.lastDiscard.tile:null}));
  acts.filter(a=>typeof a==='string' && a.startsWith('angang:')).forEach(a=>{
    const t=Number(a.split(':')[1]);
    addBtn(box,'暗杠','act-angang',()=>send({t:'angang',tile:t}));
  });
  // 加杠（补杠）：碰过的牌手里还剩第 4 张，摸牌后每轮都能杠
  acts.filter(a=>typeof a==='string' && a.startsWith('bugang:')).forEach(a=>{
    const t=Number(a.split(':')[1]);
    addBtn(box,'加杠 '+(TILE_NAMES[t]||''),'act-bugang',()=>send({t:'bugang',tile:t}));
  });
  // 牌墙已空：杠要补牌，补不出来 → 不给杠按钮。这里把原因写出来，免得以为按钮丢了
  if(self && self.isCurrent && !state.pending && state.wallLeft === 0 && !self.jinKan){
    const wait = [];
    for(const m of (self.melds||[])){
      if(m.type==='peng' && (self.hand||[]).includes(m.tiles[0])) wait.push(TILE_NAMES[m.tiles[0]]||'');
    }
    const cnt={}; for(const t of (self.hand||[])) cnt[t]=(cnt[t]||0)+1;
    for(const t in cnt) if(cnt[t]>=4) wait.push(TILE_NAMES[Number(t)]||'');
    const tip=document.createElement('span'); tip.className='act-tip act-warn';
    tip.textContent = wait.length
      ? `牌墙已空：${wait.join('、')} 没有牌可补，不能杠（这是本局最后一手）`
      : '牌墙已空：这是本局最后一手，打出后流局';
    box.appendChild(tip);
  }
}

function addBtn(box,label,cls,fn){
  const b=document.createElement('button'); b.textContent=label; b.className=cls; b.onclick=fn; box.appendChild(b);
}

// ---------- 结算 ----------
// 四行亮牌：胡家在最上面；每行 = 吃碰杠（最左） + 手牌 + 胡的那张（最右）；右侧本局加减 / 合计
function buildSettle(w){
  const wrap=document.createElement('div'); wrap.className='settle';
  const head=document.createElement('div'); head.className='srow shead';
  head.innerHTML='<span class="sname">玩家</span><span class="scards">吃碰杠 · 手牌 · 胡牌</span><span class="sdelta">本局</span><span class="stotal">合计</span>';
  wrap.appendChild(head);

  const winner = (w && w.winner!=null) ? w.winner : -1;
  const n = state.players.length;
  const seats = [];
  if(winner>=0){ for(let k=0;k<n;k++) seats.push((winner+k)%n); }
  else { state.players.forEach(p=>seats.push(p.seat)); }
  const totalWin = (w && w.payers) ? w.payers.reduce((s,x)=>s+x.amount,0) : 0;

  for(const seat of seats){
    const p = state.players.find(x=>x.seat===seat);
    if(!p) continue;
    const row=document.createElement('div');
    row.className='srow'+(seat===winner?' win':'');

    const name=document.createElement('span'); name.className='sname';
    name.innerHTML = `<b>${p.name}</b>` + (seat===state.dealer?'<span class="dealer">庄</span>':'');

    const cards=document.createElement('span'); cards.className='scards';
    if(p.melds && p.melds.length){
      const mw=document.createElement('span'); mw.className='smelds';
      p.melds.forEach(m=>mw.appendChild(meldEl(m,true)));
      cards.appendChild(mw);
    }
    const hw=document.createElement('span'); hw.className='shand';
    // 自摸时胡的那张本来就在手里 → 从手牌里挪出去，单独摆到最右边，避免重复显示
    let handTiles = (p.hand||[]).slice();
    if(seat===winner && w && w.zimo && Number.isInteger(w.winTile) && w.winTile>=0){
      const i = handTiles.indexOf(w.winTile);
      if(i>=0) handTiles.splice(i,1);
    }
    handTiles.forEach(t=>hw.appendChild(tileEl(t,{small:true,joker:t===state.joker})));
    cards.appendChild(hw);

    // 胡的那张：接在手牌最后，靠右贴边（手机换行时落在最后一行末尾）
    if(seat===winner && w && w.winTile!=null && Number.isInteger(w.winTile) && w.winTile>=0){
      const winBox=document.createElement('span'); winBox.className='swin';
      const te=tileEl(w.winTile,{small:true,joker:w.winTile===state.joker});
      te.title='胡的那张';
      winBox.appendChild(te);
      hw.appendChild(winBox);
    }

    let delta = 0;
    if(w){
      if(w.deltas && w.deltas[seat]!=null) delta = w.deltas[seat];
      else if(seat===winner) delta = totalWin;
      else {
        const pay=(w.payers||[]).find(x=>x.seat===seat);
        delta = pay ? -pay.amount : 0;
      }
    }
    const dEl=document.createElement('span');
    dEl.className='sdelta'+(delta>0?' plus':delta<0?' minus':'');
    dEl.textContent = (delta>0?'+':'') + fmtPts(delta);

    const tScore = Math.round((p.score||0)*100)/100;
    const tEl=document.createElement('span');
    tEl.className='stotal'+(tScore>0?' plus':tScore<0?' minus':'');
    tEl.textContent = (tScore>0?'+':'') + fmtPts(tScore);

    row.appendChild(name); row.appendChild(cards);
    row.appendChild(dEl); row.appendChild(tEl);
    wrap.appendChild(row);
  }
  return wrap;
}

function showResult(){
  const w = state.winners;
  const titleEl=document.getElementById('resultTitle');
  const bodyEl=document.getElementById('resultBody');
  const againBtn=document.getElementById('againBtn');
  const hintEl=document.getElementById('resultHint');
  bodyEl.innerHTML='';

  // 四圈打完 = 一将结束：本局结算面板额外标注一次总账
  const jiangEnd = !!state.jiangEnded;
  if(jiangEnd){
    const banner=document.createElement('div'); banner.className='jiang-end';
    banner.innerHTML=`<b>四圈打完 · 第 ${state.jiangNo||1} 将结算</b>`
      + `<span>四家各坐一次庄为一圈，四圈为一将。右侧「合计」就是本将总账；点「开始新一将」后重新记分。</span>`;
    bodyEl.appendChild(banner);
  }

  if(w && w.draw){
    titleEl.textContent='流局（臭庄）';
    const p=document.createElement('p'); p.className='msg';
    p.textContent='牌墙已摸完，本局流局，庄家连庄。';
    bodyEl.appendChild(p);
    bodyEl.appendChild(buildSettle(null));
  } else if(w){
    const winnerName = nameOf(w.winner);
    const kind = w.qiangjin?'抢金':(w.qianggang?'抢杠胡':(w.zimo?'自摸':'胡牌'));
    // 抢金不是点炮：拿的是开局翻出的公示金，不是谁打出来的牌
    const fromTxt = w.qiangjin
      ? `（拿公示金 ${TILE_NAMES[w.winTile]||''}）`
      : (w.zimo?'':(w.qianggang?'（被抢杠: '+nameOf(w.from)+'）':'（点炮: '+nameOf(w.from)+'）'));
    // 标题直接标明胡的牌型：对对胡 / 金雀 / 清一色…
    const winLabels = (w.labels||[]);
    const labelTxt = winLabels.length ? ' · ' + winLabels.join(' · ') : '';
    titleEl.textContent = `${winnerName} ${kind}${labelTxt} ${fromTxt}`;
    const payers = w.payers||[];
    const total = payers.reduce((s,p)=>s+p.amount,0);
    const main=document.createElement('div'); main.className='result-main';
    main.innerHTML = `片数 <b>${w.fan}</b>（${winnerName} 应收 ${fmtPts(total)} 片）`;
    bodyEl.appendChild(main);
    const tags=document.createElement('div'); tags.className='tags';
    (w.detail||[]).forEach(d=>{ const s=document.createElement('span'); s.className='tag'; s.textContent=d; tags.appendChild(s); });
    bodyEl.appendChild(tags);
    bodyEl.appendChild(buildSettle(w));
  }
  // 再来一局: 仅房主可点
  if(isHost()){
    againBtn.style.display=''; hintEl.textContent='';
    againBtn.textContent = jiangEnd ? '开始新一将' : '再来一局';
    againBtn.onclick=()=>send({t:'start'});
  } else {
    againBtn.style.display='none';
    hintEl.textContent = jiangEnd ? '四圈打完，等待房主开新一将…' : '等待房主开始下一局…';
  }
}

function renderLog(){
  const log=document.getElementById('log'); log.innerHTML='';
  state.log.forEach(l=>{ const d=document.createElement('div'); d.textContent=l; log.appendChild(d); });
  log.scrollTop=log.scrollHeight;
}

// ---------- 大厅事件 ----------
document.getElementById('createBtn').onclick=()=>{
  const name=document.getElementById('nameInput').value.trim()||'玩家';
  send({t:'create',name});
};
document.getElementById('joinBtn').onclick=()=>{
  const room=document.getElementById('roomInput').value.trim().toUpperCase();
  const name=document.getElementById('nameInput').value.trim()||'玩家';
  if(room.length<2){ showMsg('请输入房间码',true); return; }
  send({t:'join',room,name});
};

document.getElementById('startBtn').onclick=()=>{
  send({t:'start'});
};

document.getElementById('addBotBtn').onclick=()=>send({t:'addBot'});
document.getElementById('removeBotBtn').onclick=()=>send({t:'removeBot'});

connect();
