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
    case 'state': {
      state = msg.state;
      // 等待阶段有人退出后座位会重排，以服务端下发的 selfSeat 为准
      if (state && state.selfSeat != null) mySeat = state.selfSeat;
      // v11：事件流随 state 一起到——音效/特效按真实动作播，不靠 diff 猜
      if (msg.events && msg.events.length) msg.events.forEach(onGameEvent);
      render();
      break;
    }
    case 'emoji': onEmoji(msg.seat, msg.id); break;
    case 'left': finishLeave(); break;
    case 'error': showMsg(msg.msg, true); break;
  }
}

// ---------- 视图切换 ----------
function showGame(){
  document.getElementById('lobby').classList.remove('active');
  document.getElementById('game').classList.add('active');

}
function showMsg(text, isErr){ const el=document.getElementById('lobbyMsg'); el.textContent=text; el.style.color=isErr?'#ffb3b3':'#dfffdf'; }

function nameOf(seat){ const p = state && state.players.find(x=>x.seat===seat); return p ? p.name : ('座位'+seat); }
function isHost(){ return state && state.selfSeat === 0; }
// 片数显示：整数不带小数，四分之一片保留两位
function fmtPts(n){
  const v = Math.round((n||0)*100)/100;
  // 包牌会分出 37.5 这种半片：显示一位就够，别写成 37.50
  return String(parseFloat(v.toFixed(2)));
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
  // 只有真正开打之后才要求横屏：等待房间竖屏也能加机器人、退房、看规则
  document.body.classList.toggle('in-game', state.phase !== 'waiting');
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
  // 胡牌：先让特效放完（或点一下跳过），再弹结算面板，别让"混一色"三个字压住整张牌谱
  if(state.phase==='ended'){ scheduleResult(); }
  else { clearTimeout(resultTimer); setOverlay('resultModal', false); }

  if(state.phase==='waiting'){ renderWaiting(); requestAnimationFrame(placeSocial); return; }
  if(state.phase==='swap'){ renderSwap(); }

  renderTable();
  renderActions();
  renderLog();
  requestAnimationFrame(placeSocial);
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

/* ============================================================
   v11：音效 · 大牌特效 · 快捷表情
   - 音效全部用 Web Audio 现场合成，不依赖任何 mp3 文件
     （离线可用、不增加部署体积、不会被运营商/代理压成半截）
   - 事件由服务端随 state 一起下发（msg.events），所以碰/杠/大牌分得清
   ============================================================ */

/* ---------------- 中文报牌语音：索引表 ---------------- */
// key -> [在 voice.mp3 里的起始秒, 时长秒]。由 tools/make-voice.py 生成，勿手改。
/*VOICE_INDEX_BEGIN*/
const VOICE_INDEX = {"1m":[0.0,0.478],"2m":[0.478,0.505],"3m":[0.983,0.513],"4m":[1.496,0.531],"5m":[2.027,0.445],"6m":[2.472,0.492],"7m":[2.964,0.523],"8m":[3.487,0.482],"9m":[3.969,0.482],"1s":[4.451,0.516],"2s":[4.967,0.531],"3s":[5.498,0.57],"4s":[6.068,0.584],"5s":[6.652,0.5],"6s":[7.152,0.549],"7s":[7.701,0.549],"8s":[8.25,0.53],"9s":[8.78,0.525],"1p":[9.305,0.53],"2p":[9.835,0.543],"3p":[10.378,0.579],"4p":[10.957,0.554],"5p":[11.511,0.533],"6p":[12.044,0.538],"7p":[12.582,0.547],"8p":[13.129,0.552],"9p":[13.681,0.569],"hua":[14.25,0.279],"peng":[14.529,0.344],"chi":[14.873,0.331],"gang":[15.204,0.311],"angang":[15.515,0.465],"bugang":[15.98,0.435],"ting":[16.415,0.541],"jinkan":[16.956,0.503],"hu":[17.459,0.329],"zimo":[17.788,0.46],"qiangjin":[18.248,0.493],"qianggang":[18.741,0.759],"drawgame":[19.5,0.547],"qingyise":[20.047,0.643],"hunyise":[20.69,0.597],"jinlong":[21.287,0.493],"jinque":[21.78,0.523],"duidui":[22.303,0.674],"duidui_jin":[22.977,1.23],"sanjindao":[24.207,0.651],"tianhu":[24.858,0.584]};
/*VOICE_INDEX_END*/

/* ---------------- 音效引擎 ---------------- */
const Sound = (() => {
  const AC = window.AudioContext || window.webkitAudioContext;
  let ac = null, master = null, noiseBuf = null;
  let muted = false;
  try { muted = localStorage.getItem('fz_mute') === '1'; } catch (e) { /* 隐私模式 */ }
  const lastAt = {};

  /* ---- 报牌语音（一条 mp3 精灵，按下标切片播） ---- */
  let voiceBuf = null, voiceState = 'idle';   // idle / loading / ready / fail
  let voiceOn = true;
  try { voiceOn = localStorage.getItem('fz_voice') !== '0'; } catch (e) { /* 隐私模式 */ }
  let curVoice = null;
  const VOICE_URL = (typeof window.__VOICE_DATA === 'string' && window.__VOICE_DATA)
    ? window.__VOICE_DATA : 'voice/voice.mp3';

  function ctx() {
    if (!AC) return null;
    if (!ac) {
      ac = new AC();
      const comp = ac.createDynamicsCompressor();
      comp.threshold.value = -16; comp.knee.value = 16; comp.ratio.value = 5;
      comp.attack.value = 0.004; comp.release.value = 0.2;
      master = ac.createGain();
      master.gain.value = muted ? 0 : 0.9;
      master.connect(comp); comp.connect(ac.destination);
      const len = Math.floor(ac.sampleRate * 1.0);
      noiseBuf = ac.createBuffer(1, len, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (ac.state === 'suspended') ac.resume();
    return ac;
  }

  // 牌磕在桌面上的"啪"：噪声过带通 + 木头闷响
  function clack(t, o) {
    const f = o.f || 1500, g = o.g == null ? 0.2 : o.g, dur = o.dur || 0.05, q = o.q || 1.2;
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    src.playbackRate.value = 0.85 + Math.random() * 0.4;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
    const gn = ac.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(g, t + 0.004);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(bp); bp.connect(gn); gn.connect(master);
    src.start(t); src.stop(t + dur + 0.03);
    if (o.thud) {
      const os = ac.createOscillator(); os.type = 'sine';
      os.frequency.setValueAtTime(o.thud, t);
      os.frequency.exponentialRampToValueAtTime(o.thud * 0.55, t + 0.13);
      const g2 = ac.createGain();
      g2.gain.setValueAtTime(0.0001, t);
      g2.gain.linearRampToValueAtTime(g * 0.85, t + 0.006);
      g2.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
      os.connect(g2); g2.connect(master); os.start(t); os.stop(t + 0.17);
    }
  }

  function tone(t, freq, dur, o) {
    o = o || {};
    const os = ac.createOscillator(); os.type = o.type || 'triangle';
    os.frequency.setValueAtTime(freq, t);
    if (o.to) os.frequency.exponentialRampToValueAtTime(o.to, t + dur);
    const gn = ac.createGain();
    const g = o.g == null ? 0.15 : o.g;
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(g, t + (o.attack || 0.008));
    gn.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    os.connect(gn); gn.connect(master);
    os.start(t); os.stop(t + dur + 0.02);
  }

  function fanfare(t, big) {
    const notes = big ? [523.25, 659.25, 783.99, 1046.5, 1318.5] : [659.25, 783.99, 1046.5];
    const step = big ? 0.1 : 0.085;
    notes.forEach((f, i) => {
      tone(t + i * step, f, 0.45, { type: 'triangle', g: 0.13 });
      tone(t + i * step, f * 2, 0.3, { type: 'sine', g: 0.045 });
    });
  }

  // 铜锣：一堆不成谐波的正弦叠加 + 金属沙声，比单纯"叮"更像胡牌
  function gong(t, g) {
    g = g == null ? 0.42 : g;
    [98, 146.8, 196, 261.6, 392, 523.3].forEach((f, i) => {
      const os = ac.createOscillator(); os.type = 'sine';
      os.frequency.setValueAtTime(f * 1.008, t);
      os.frequency.exponentialRampToValueAtTime(f * 0.968, t + 2.4);
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.linearRampToValueAtTime(g / (1.4 + i * 0.85), t + 0.012);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
      os.connect(gn); gn.connect(master); os.start(t); os.stop(t + 2.7);
    });
    const src = ac.createBufferSource(); src.buffer = noiseBuf;
    const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2200; bp.Q.value = 0.7;
    const gn = ac.createGain();
    gn.gain.setValueAtTime(0.0001, t);
    gn.gain.linearRampToValueAtTime(g * 0.26, t + 0.02);
    gn.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    src.connect(bp); bp.connect(gn); gn.connect(master); src.start(t); src.stop(t + 1.2);
  }

  /* ---- 语音：加载 / 打断 / 按优先级播 ---- */
  // 一次性把整条 mp3 解码进内存，之后每句都是 0 延迟切片，不像 TTS 那样现合成
  function loadVoice() {
    if (voiceState === 'loading' || voiceState === 'ready' || voiceState === 'fail') return;
    let c;
    try { c = ctx(); } catch (e) { voiceState = 'fail'; return; }
    if (!c || !c.decodeAudioData) { voiceState = 'fail'; return; }
    voiceState = 'loading';
    const decode = (ab) => new Promise((ok, no) => {
      const p = c.decodeAudioData(ab, ok, no);   // 老 Safari 只认回调式
      if (p && p.then) p.then(ok, no);
    }).then((b) => { voiceBuf = b; voiceState = 'ready'; })
      .catch(() => { voiceState = 'fail'; });

    // 单文件版把语音包内联成 data URI。微信/WKWebView 对 fetch(data:) 支持不稳
    // （有的直接抛 TypeError），所以自己解 base64，不经过网络栈。
    if (VOICE_URL.slice(0, 5) === 'data:') {
      try {
        const bin = atob(VOICE_URL.slice(VOICE_URL.indexOf(',') + 1));
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        decode(u8.buffer);
      } catch (e) { voiceState = 'fail'; }
      return;
    }
    fetch(VOICE_URL)
      .then((r) => { if (!r.ok) throw new Error(r.status); return r.arrayBuffer(); })
      .then(decode)
      .catch(() => { voiceState = 'fail'; });
  }

  function stopVoice() {
    if (curVoice && curVoice.src) {
      try { curVoice.src.onended = null; curVoice.src.stop(); } catch (e) { /* 已播完 */ }
    }
    curVoice = null;
  }

  function playVoice(key, prio, gain) {
    const idx = VOICE_INDEX[key];
    if (!voiceBuf || !idx) return;
    const t = ac.currentTime + 0.008;
    const src = ac.createBufferSource(); src.buffer = voiceBuf;
    const gn = ac.createGain();
    const dur = idx[1];
    gn.gain.setValueAtTime(gain, t);
    gn.gain.setValueAtTime(gain, t + Math.max(0, dur - 0.07));   // 收尾 70ms 淡出，防削波
    gn.gain.linearRampToValueAtTime(0.0001, t + dur);
    src.connect(gn); gn.connect(master);
    src.start(t, idx[0], dur);
    curVoice = { src, prio, key };
    src.onended = () => { if (curVoice && curVoice.src === src) curVoice = null; };
  }

  // prio 1=牌名 2=动作 3=胡牌。后来的优先级不低于当前才插播，否则丢掉（不排队，避免报牌越拖越晚）
  function say(key, opt) {
    if (!voiceOn) return;
    opt = opt || {};
    const prio = opt.prio || 1;
    if (opt.delay) { setTimeout(() => say(key, Object.assign({}, opt, { delay: 0 })), opt.delay); return; }
    if (voiceState === 'idle') loadVoice();
    if (!ac || ac.state !== 'running') { try { ctx(); } catch (e) { return; } }
    if (voiceState !== 'ready' || muted) return;
    if (curVoice && curVoice.prio > prio) return;
    stopVoice();
    playVoice(key, prio, opt.gain == null ? 0.9 : opt.gain);
  }

  // 连读：牌型 + 动作（"清一色！……自摸！"），间隔按上一句真实时长算
  function saySeq(keys, prio, gain) {
    let d = 0;
    keys.forEach((k) => {
      if (!k) return;
      const idx = VOICE_INDEX[k];
      if (!idx) return;
      say(k, { prio, gain, delay: d });
      d += idx[1] * 1000 + 80;
    });
  }

  const P = {
    // 界面/系统
    point() { const t = ac.currentTime; tone(t, 880, 0.07, { type: 'square', g: 0.05 }); },
    deal() {
      const t = ac.currentTime + 0.02;
      for (let i = 0; i < 12; i++) clack(t + i * 0.05 + Math.random() * 0.02, { f: 1000 + Math.random() * 900, g: 0.07, dur: 0.04 });
    },
    dice() {
      const t = ac.currentTime + 0.01;
      for (let i = 0; i < 16; i++) clack(t + Math.random() * 0.7, { f: 900 + Math.random() * 1700, g: 0.055 + Math.random() * 0.05, dur: 0.035 });
      const src = ac.createBufferSource(); src.buffer = noiseBuf; src.loop = true;
      const bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 2400; bp.Q.value = 0.6;
      const gn = ac.createGain();
      gn.gain.setValueAtTime(0.0001, t);
      gn.gain.linearRampToValueAtTime(0.055, t + 0.06);
      gn.gain.setValueAtTime(0.055, t + 0.5);
      gn.gain.exponentialRampToValueAtTime(0.0001, t + 0.72);
      src.connect(bp); bp.connect(gn); gn.connect(master); src.start(t); src.stop(t + 0.76);
    },
    swap() {
      const t = ac.currentTime;
      for (let i = 0; i < 3; i++) clack(t + i * 0.06, { f: 1800, g: 0.09, dur: 0.05 });
      tone(t + 0.22, 880, 0.2, { type: 'sine', g: 0.07 });
      tone(t + 0.22, 1320, 0.2, { type: 'sine', g: 0.04 });
    },
    joker() {
      const t = ac.currentTime;
      tone(t, 1046.5, 0.55, { type: 'sine', g: 0.13 });
      tone(t + 0.06, 1568, 0.6, { type: 'sine', g: 0.08 });
      tone(t + 0.12, 2093, 0.55, { type: 'sine', g: 0.04 });
    },
    // 牌桌
    draw(o) { const t = ac.currentTime; clack(t, { f: o && o.me ? 2000 : 2700, g: o && o.me ? 0.13 : 0.06, dur: 0.04 }); },
    discard() { const t = ac.currentTime; clack(t, { f: 1300, g: 0.23, dur: 0.06, thud: 120 }); },
    peng() { const t = ac.currentTime; clack(t, { f: 1100, g: 0.25, dur: 0.06, thud: 135 }); clack(t + 0.08, { f: 900, g: 0.2, dur: 0.07, thud: 110 }); },
    chi() { const t = ac.currentTime; clack(t, { f: 1900, g: 0.13, dur: 0.05 }); clack(t + 0.055, { f: 1500, g: 0.15, dur: 0.05 }); },
    gang() { const t = ac.currentTime; [0, 0.06, 0.12].forEach((d, i) => clack(t + d, { f: 900 + i * 170, g: 0.22, dur: 0.06, thud: 120 })); },
    angang() { const t = ac.currentTime; [0, 0.07, 0.14, 0.21].forEach((d, i) => clack(t + d, { f: 780 + i * 140, g: 0.21, dur: 0.07, thud: 105 })); },
    bugang() { const t = ac.currentTime; [0, 0.07, 0.14, 0.21].forEach((d, i) => clack(t + d, { f: 820 + i * 150, g: 0.22, dur: 0.07, thud: 110 })); },
    ting() { const t = ac.currentTime; tone(t, 1318.5, 0.3, { type: 'sine', g: 0.1 }); tone(t + 0.09, 1760, 0.35, { type: 'sine', g: 0.07 }); },
    jinkan() { gong(ac.currentTime, 0.3); },
    hu() { fanfare(ac.currentTime + 0.02, false); },
    bigwin() {
      const t = ac.currentTime + 0.02;
      gong(t, 0.5);
      fanfare(t + 0.28, true);
      tone(t + 0.9, 2093, 1.2, { type: 'sine', g: 0.05 });
    },
    drawgame() {
      const t = ac.currentTime;
      tone(t, 392, 0.3, { type: 'triangle', g: 0.1 });
      tone(t + 0.18, 311.1, 0.42, { type: 'triangle', g: 0.1 });
      tone(t + 0.36, 233.1, 0.6, { type: 'triangle', g: 0.09 });
    },
    // 表情（每个性格给一段不同的短音）
    emoji_hurry() {
      const t = ac.currentTime;
      [1200, 1500, 1200].forEach((f, i) => tone(t + i * 0.1, f, 0.07, { type: 'square', g: 0.055 }));
    },
    emoji_help() {
      const t = ac.currentTime;
      for (let i = 0; i < 5; i++) tone(t + i * 0.16, i % 2 ? 988 : 740, 0.14, { type: 'square', g: 0.05 });
    },
    emoji_kneel() {
      const t = ac.currentTime;
      // 两声"求——求——"，每声都往下坠，最后叹一口气
      [0, 0.3].forEach((d, i) => {
        tone(t + d, i ? 620 : 700, 0.26, { type: 'sine', to: 430, g: 0.115 });
        tone(t + d, i ? 310 : 350, 0.26, { type: 'triangle', to: 215, g: 0.05 });
      });
      tone(t + 0.66, 300, 0.55, { type: 'sine', to: 175, g: 0.075 });
    },
    emoji_who() {
      const t = ac.currentTime;
      tone(t, 110, 0.5, { type: 'sawtooth', g: 0.13 });
      tone(t, 165, 0.5, { type: 'sawtooth', g: 0.09 });
      clack(t, { f: 700, g: 0.16, dur: 0.09, thud: 90 });
    }
  };

  return {
    get muted() { return muted; },
    setMuted(v) {
      muted = !!v;
      try { localStorage.setItem('fz_mute', muted ? '1' : '0'); } catch (e) { /* ignore */ }
      const c = ctx();
      if (c) master.gain.setTargetAtTime(muted ? 0 : 0.9, c.currentTime, 0.02);
      if (!muted) this.play('point');
    },
    unlock() {
      try {
        const c = ctx();
        if (c && c.state === 'suspended') c.resume();
        if (c) loadVoice();          // 首次点击就把语音包解好，打第一张牌时不用等
      } catch (e) { /* ignore */ }
    },
    say, saySeq,
    get voiceOn() { return voiceOn; },
    get voiceState() { return voiceState; },
    setVoiceOn(v) {
      voiceOn = !!v;
      try { localStorage.setItem('fz_voice', voiceOn ? '1' : '0'); } catch (e) { /* ignore */ }
      if (!voiceOn) { stopVoice(); return; }
      loadVoice();
      // 刚点开时语音包可能还在解码，等它就绪再放一声示例，别让按钮点下去没反应
      let tries = 0;
      const demo = () => {
        if (!voiceOn) return;
        if (voiceState === 'ready') { say('1m', { prio: 3 }); return; }
        if (voiceState === 'fail' || tries++ > 12) return;
        setTimeout(demo, 150);
      };
      demo();
    },
    play(name, opt) {
      if (muted) return;
      let c;
      try { c = ctx(); } catch (e) { return; }
      if (!c || ac.state !== 'running') return;
      const now = performance.now();
      if (lastAt[name] && now - lastAt[name] < 32) return; // 同一音效防抖：避免瞬移式连点糊成噪音
      lastAt[name] = now;
      try { P[name] && P[name](opt); } catch (e) { /* 音频失败不影响牌局 */ }
    }
  };
})();

// 首次交互解锁音频（iOS/Safari 必须在用户手势里创建 AudioContext）
['pointerdown', 'touchstart', 'keydown'].forEach((ev) => {
  document.addEventListener(ev, () => Sound.unlock(), { passive: true });
});
document.addEventListener('visibilitychange', () => { if (!document.hidden) Sound.unlock(); });

/* ---------------- 牌局事件 → 音效 / 特效 ---------------- */
// 牌 → 语音 key：数牌 1m..9p，花牌统一念"花"
function tileVoiceKey(tile) {
  if (tile == null || tile < 0) return null;
  if (tile >= 27) return 'hua';
  return ((tile % 9) + 1) + (tile < 9 ? 'm' : tile < 18 ? 's' : 'p');
}
// 牌型标签 → 语音 key
const LABEL_VOICE = {
  '纯清一色': 'qingyise', '混一色': 'hunyise', '金龙': 'jinlong', '金雀': 'jinque',
  '对对胡（有金）': 'duidui_jin', '对对胡': 'duidui', '三金倒': 'sanjindao', '天胡': 'tianhu',
};

function onGameEvent(ev) {
  if (!ev || !ev.ev) return;
  switch (ev.ev) {
    case 'deal': Sound.play('deal'); break;
    case 'dice': Sound.play('dice'); break;
    case 'swap': Sound.play('swap'); break;
    case 'joker': Sound.play('joker'); break;
    case 'draw': Sound.play('draw', { me: ev.seat === mySeat }); break;
    case 'discard':
      Sound.play('discard');
      Sound.say(tileVoiceKey(ev.tile), { prio: 1, gain: ev.seat === mySeat ? 1 : 0.7 });
      break;
    case 'peng': Sound.play('peng'); Sound.say('peng', { prio: 2 }); break;
    case 'chi': Sound.play('chi'); Sound.say('chi', { prio: 2 }); break;
    case 'gang':
      Sound.play('gang'); Sound.say('gang', { prio: 2 }); break;
    case 'angang':
      Sound.play('angang'); Sound.say('angang', { prio: 2 }); break;
    case 'bugang':
      Sound.play('bugang'); Sound.say('bugang', { prio: 2 }); break;
    case 'ting': Sound.play('ting'); Sound.say('ting', { prio: 2 }); break;
    case 'jinkan': Sound.play('jinkan'); Sound.say('jinkan', { prio: 2 }); break;
    case 'hu': {
      Sound.play(ev.big ? 'bigwin' : 'hu');
      showWinFX(ev);
      // 有牌型先喊牌型再喊胡法（"清一色！……自摸！"），没有就单喊一个
      const types = (ev.labels || []).map((l) => LABEL_VOICE[l]).filter(Boolean);
      const act = ev.zimo ? 'zimo' : ev.qiangjin ? 'qiangjin' : ev.qianggang ? 'qianggang' : 'hu';
      Sound.saySeq(types.length ? [types[0], act] : [act], 3);
      break;
    }
    case 'drawgame': Sound.play('drawgame'); Sound.say('drawgame', { prio: 3 }); break;
    default: break;
  }
}

/* ---------------- 大牌特效 ---------------- */
let fxTimer = null;
let resultHoldUntil = 0;   // 特效播完之前不弹结算面板
let resultTimer = null;

function clearFX() {
  const layer = document.getElementById('fxLayer');
  clearTimeout(fxTimer);
  if (layer) { layer.className = 'fx-layer'; layer.innerHTML = ''; layer.onclick = null; }
}

// 急性子点一下就跳过庆祝，直接看牌谱
function skipFX() {
  clearFX();
  resultHoldUntil = 0;
  clearTimeout(resultTimer);
  if (state && state.phase === 'ended') { setOverlay('resultModal', true); showResult(); }
}

// 结算面板：等特效放完再出现；期间再来 state 也不会叠计时器
function scheduleResult() {
  const wait = Math.max(0, resultHoldUntil - Date.now());
  setOverlay('resultModal', false);
  clearTimeout(resultTimer);
  if (wait > 0) {
    resultTimer = setTimeout(() => {
      if (state && state.phase === 'ended') { setOverlay('resultModal', true); showResult(); }
    }, wait);
  } else {
    setOverlay('resultModal', true);
    showResult();
  }
}
function showWinFX(ev) {
  const layer = document.getElementById('fxLayer');
  if (!layer) return;
  const bonus = ev.bonus || 0;
  // 1=普通胡（小闪一下）2=有奖励的大牌 3=48 片级大牌（清一色/混一色/金龙）
  const lv = !ev.big ? 1 : (bonus >= 24 ? 3 : 2);
  clearTimeout(fxTimer);
  layer.innerHTML = '';
  layer.className = 'fx-layer show' + (lv === 3 ? ' shake' : '');
  resultHoldUntil = Date.now() + (lv === 3 ? 3100 : lv === 2 ? 2500 : 1150);
  layer.onclick = skipFX;
  // 大牌面前先清掉表情气泡，别跟"金雀"抢位置
  const eb = document.getElementById('emojiLayer');
  if (eb) eb.innerHTML = '';

  const flash = document.createElement('div'); flash.className = 'fx-flash'; layer.appendChild(flash);
  if (lv > 1) {
    const rays = document.createElement('div'); rays.className = 'fx-rays'; layer.appendChild(rays);
    const n = lv === 3 ? 36 : 22;
    for (let i = 0; i < n; i++) {
      const c = document.createElement('span');
      c.className = 'fx-coin';
      c.textContent = i % 5 === 0 ? '✦' : (i % 3 === 0 ? '●' : '金');
      c.style.left = (Math.random() * 100) + 'vw';
      c.style.fontSize = (12 + Math.random() * 16) + 'px';
      c.style.animationDuration = (1.7 + Math.random() * 1.3) + 's';
      c.style.animationDelay = (Math.random() * 0.8) + 's';
      layer.appendChild(c);
    }
  }

  const box = document.createElement('div'); box.className = 'fx-title';
  const kind = ev.qiangjin ? '抢金' : ev.qianggang ? '抢杠胡' : ev.zimo ? '自摸' : '胡牌';
  const labels = ev.labels || [];
  const big = document.createElement('div');
  big.className = 'fx-big' + (lv === 1 ? ' lv1' : '');
  big.textContent = (lv === 1 || !labels.length) ? (lv === 1 ? '胡' : kind) : labels[0];
  box.appendChild(big);
  const sub = document.createElement('div'); sub.className = 'fx-sub';
  sub.textContent = [ev.name || '', kind].concat(labels.slice(lv === 1 ? 0 : 1)).filter(Boolean).join(' · ');
  box.appendChild(sub);
  const fan = document.createElement('div'); fan.className = 'fx-fan';
  fan.innerHTML = `<b>${ev.fan == null ? '' : ev.fan}</b> 片`;
  box.appendChild(fan);
  layer.appendChild(box);

  fxTimer = setTimeout(() => { layer.className = 'fx-layer'; layer.innerHTML = ''; },
    lv === 3 ? 3400 : lv === 2 ? 2800 : 1500);
}

/* ---------------- 快捷表情 ---------------- */
const EMOJIS = [
  { id: 'hurry', icon: '⏰', label: '打快点打快点', text: '打快点打快点', tone: 'warn' },
  { id: 'help',  icon: '🆘', label: '救命', text: '救命', tone: 'red' },
  { id: 'kneel', icon: '🙏', label: '别做了求求了', text: '别做了\n求求了', tone: 'plead' },
  { id: 'who',   icon: '😤', label: '还有谁', text: '还有谁', tone: 'swag' }
];

function buildEmojiPanel() {
  const grid = document.getElementById('emojiGrid');
  if (!grid || grid.dataset.ready) return;
  grid.dataset.ready = '1';
  EMOJIS.forEach((e) => {
    const b = document.createElement('button');
    b.className = 'ep-item';
    b.dataset.id = e.id;
    b.innerHTML = `<span class="ep-ico">${e.icon}</span><span class="ep-lab">${e.label}</span>`;
    b.onclick = (ev) => { if (ev) ev.stopPropagation(); sendEmoji(e.id); };
    grid.appendChild(b);
  });
}

let emojiCoolUntil = 0;
function sendEmoji(id) {
  const btn = document.getElementById('emojiBtn');
  const now = Date.now();
  if (now < emojiCoolUntil) {  // 连点太快：抖一下，不重复发
    if (btn) { btn.classList.add('shake'); setTimeout(() => btn.classList.remove('shake'), 320); }
    return;
  }
  emojiCoolUntil = now + 1100;
  send({ t: 'emoji', id });
  Sound.play('point');
  toggleEmojiPanel(false);
}

function onEmoji(seat, id) {
  if (seat == null || !id) return;
  Sound.play('emoji_' + id);
  showEmojiBubble(seat, id);
}

// 气泡贴着说话人的位置弹出来
function seatAnchor(seat) {
  const selfSeat = state ? state.selfSeat : 0;
  if (seat === selfSeat) {
    const h = document.getElementById('hand');
    const r = h.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top - 6, cls: 'pos-self', tail: '50%' };
  }
  const idx = (seat - selfSeat + 4) % 4;
  const sel = ['', '.opp-right', '.opp-top', '.opp-left'][idx];
  const el = document.querySelector(sel);
  if (!el) return null;
  const r = el.getBoundingClientRect();
  if (idx === 1) return { x: r.left - 8, y: r.top + r.height / 2, cls: 'pos-right', tail: 'calc(100% - 14px)' };
  if (idx === 2) return { x: r.left + r.width / 2, y: r.bottom + 6, cls: 'pos-top', tail: '50%' };
  return { x: r.right + 8, y: r.top + r.height / 2, cls: 'pos-left', tail: '14px' };
}

let bubbleTimers = {};
function showEmojiBubble(seat, id) {
  const e = EMOJIS.find((x) => x.id === id);
  const layer = document.getElementById('emojiLayer');
  if (!e || !layer) return;
  const old = layer.querySelector(`[data-seat="${seat}"]`);
  if (old) old.remove();
  clearTimeout(bubbleTimers[seat]);

  const b = document.createElement('div');
  b.className = 'emoji-bubble tone-' + e.tone;   // 配色类名必须带 tone- 前缀，否则四种语气全变白底
  b.dataset.seat = String(seat);
  const inner = document.createElement('div');
  inner.className = 'eb-inner';
  const ico = document.createElement('span'); ico.className = 'eb-ico'; ico.textContent = e.icon;
  const txt = document.createElement('span'); txt.className = 'eb-txt'; txt.textContent = e.text;
  inner.appendChild(ico); inner.appendChild(txt);
  b.appendChild(inner);

  const a = seatAnchor(seat);
  if (!a) return;
  b.style.left = Math.round(a.x) + 'px';
  b.style.top = Math.round(a.y) + 'px';
  b.style.setProperty('--tail', a.tail);
  b.classList.add(a.cls);
  layer.appendChild(b);

  bubbleTimers[seat] = setTimeout(() => {
    b.classList.add('out');
    setTimeout(() => b.remove(), 320);
  }, 2800);
}

/* ---------------- 面板 / 按钮 ---------------- */
function placeSocial() {
  // v12.1：三个按钮改成横排、固定在右下角（CSS 负责），不再跟着操作栏垂直居中 ——
  //   竖排时 132px 高会往上顶到手牌区，把牌挡住
  const s = document.getElementById('social');
  if (s) s.style.top = '';
}

function toggleEmojiPanel(force) {
  const p = document.getElementById('emojiPanel');
  const btn = document.getElementById('emojiBtn');
  if (!p || !btn) return;
  const on = force == null ? !p.classList.contains('show') : !!force;
  p.classList.toggle('show', on);
  const bd = document.getElementById('emojiBackdrop');
  if (bd) bd.classList.toggle('show', on);
  btn.textContent = on ? '✕' : '😀';
  if (!on) return;
  const r = btn.getBoundingClientRect();
  // 按钮改成横排后，😀 在最左边；面板要对齐整组按钮的右边缘，否则会顶出屏幕左边
  const group = document.getElementById('social');
  const gr = group ? group.getBoundingClientRect() : r;
  p.style.right = Math.max(8, Math.round(window.innerWidth - gr.right)) + 'px';
  const h = p.offsetHeight;
  if (r.top - 10 >= h) {           // 按钮上方放得下 → 住在上面
    p.style.bottom = Math.round(window.innerHeight - r.top + 6) + 'px';
    p.style.top = 'auto';
  } else {                          // 放不下 → 贴到顶部
    p.style.top = '8px';
    p.style.bottom = 'auto';
  }
}

(function initSocial() {
  const btn = document.getElementById('emojiBtn');
  const mute = document.getElementById('muteBtn');
  if (btn) {
    buildEmojiPanel();
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggleEmojiPanel(); });
  }
  if (mute) {
    const sync = () => {
      mute.textContent = Sound.muted ? '🔇' : '🔊';
      mute.classList.toggle('off', Sound.muted);
      mute.title = Sound.muted ? '音效已关（点一下打开）' : '音效已开（点一下关闭）';
    };
    mute.addEventListener('click', (e) => { e.stopPropagation(); Sound.setMuted(!Sound.muted); sync(); });
    sync();
  }
  const voice = document.getElementById('voiceBtn');
  if (voice) {
    const syncV = () => {
      const bad = Sound.voiceState === 'fail';
      voice.classList.toggle('off', !Sound.voiceOn);
      voice.classList.toggle('bad', bad);
      voice.title = bad ? '语音包没加载出来（刷新页面试试）'
        : Sound.voiceOn ? '报牌语音已开（点一下关闭）' : '报牌语音已关（点一下打开）';
    };
    voice.addEventListener('click', (e) => {
      e.stopPropagation();
      if (Sound.voiceState === 'fail') { showMsg('语音包没加载出来，刷新一次页面试试', true); return; }
      Sound.setVoiceOn(!Sound.voiceOn);
      syncV();
    });
    syncV();
  }
  const bd = document.getElementById('emojiBackdrop');
  if (bd) bd.addEventListener('click', () => toggleEmojiPanel(false));
  document.addEventListener('click', (e) => {
    const p = document.getElementById('emojiPanel');
    if (!p || !p.classList.contains('show')) return;
    if (p.contains(e.target) || (e.target.closest && e.target.closest('#emojiBtn'))) return;
    toggleEmojiPanel(false);
  });
  window.addEventListener('resize', () => { placeSocial(); toggleEmojiPanel(false); });
  window.addEventListener('orientationchange', () => setTimeout(placeSocial, 220));
  placeSocial();
})();

/* ============================================================
   v11：规则说明（首页入口）+ 从房间返回首页
   ============================================================ */

/* ---- 规则正文：改这里就能改弹窗内容，不用动 HTML ---- */
const RULE_SECTIONS = [
  {
    t: '一分钟上手',
    h: `
      <p><b>4 个人，17 张牌成胡</b>：5 组面子（顺子或刻子）＋ 1 对将。</p>
      <ul>
        <li>每人起手 <b>16 张</b>，庄家 <b>17 张</b>；开局先<b>换牌</b>、再<b>开金</b>，然后轮流摸打。</li>
        <li><b>金是万能牌</b>，可以当任意一张数牌用；但金不能吃、不能碰、不能杠、不能点炮。</li>
        <li><b>小胡只能自摸</b>。想靠别人打出的牌胡，必须是有奖励的<b>大牌</b>。</li>
        <li>胡牌收 <b>3 份</b>：自摸三家各付，点炮也是三家各付，放炮的人不多付。</li>
      </ul>
      <span class="hl">第一次玩就记住两句：<b>金不能吃碰杠</b>、<b>能胡的人没表态前别抢着碰</b>。</span>
    `
  },
  {
    t: '牌库与花、金',
    h: `
      <ul>
        <li>牌库 <b>144 张</b>：万 / 条 / 筒各 1-9，每种 4 张（108 张）＋ <b>花牌 36 张</b>。</li>
        <li>花牌 = 春夏秋冬梅兰竹菊各 1 张，加上<b>东南西北中发白各 4 张</b>。福麻没有字牌，字牌全部当花，不参与面子。</li>
        <li><b>花即分</b>：摸到花立刻亮出计 1 朵，并从牌尾补一张，补到不是花为止。</li>
        <li><b>开金</b>：从牌尾翻一张数牌，<b>该种类 4 张全部是金</b>。翻出的这 1 张公示、不流通，所以场上实际能用的金是 <b>3 张</b>。</li>
        <li>金可以打出去，而且打出的金<b>没人能吃碰胡</b>，是一张绝对安全牌。</li>
      </ul>
    `
  },
  {
    t: '开局：发牌 → 换牌 → 开金',
    h: `
      <p><b>① 发牌</b>：庄家掷 2 颗骰子决定起抓位置，四家各 16 张，<b>庄家多 1 张 = 17 张</b>，然后补花。</p>
      <p><b>② 换牌</b>（大乱斗特色）：庄家再摇一次 2 颗骰子，决定这轮往哪个方向换。</p>
      <div class="rule-scroll"><table>
        <tr><th>点数</th><th>怎么换</th></tr>
        <tr><td>5 / 9</td><td>重摇</td></tr>
        <tr><td>3 / 7 / 11</td><td>给<b>对家</b></td></tr>
        <tr><td>2 / 6 / 10</td><td>给<b>下家</b></td></tr>
        <tr><td>4 / 8 / 12</td><td>给<b>上家</b></td></tr>
      </table></div>
      <ul>
        <li>四家各自选一门花色（万 / 条 / 筒），从这门里挑 <b>3 张</b>换出去，<b>环形传递</b>：你给出去的同时收到另一家的 3 张。</li>
        <li>庄家是从自己的 <b>17 张</b>里挑 3 张，换完不再额外摸牌。</li>
        <li>别人只看到「已选好」，看不到你选的是哪一门。</li>
        <li><b>四家选的花色完全一样 → 这轮无效</b>，重新摇骰、重新换（不算一局结束，不涨连庄）。</li>
        <li>换牌按<b>张</b>挑：手里两张 7 万，可以只换其中一张。30 秒没选，系统自动挑你手里最多的一门换出。</li>
      </ul>
      <p><b>③ 开金 + 庄家首打</b>：开金后庄家先打掉一张多余的牌，这一手进入<b>抢金窗口</b>（见下一节）；没有天胡就先打牌。</p>
    `
  },
  {
    t: '抢金：开局那一手',
    h: `
      <ul>
        <li>庄家开金后打出第一张，<b>四家都能抢</b>——把开局翻出的那张<b>公示金</b>拿进手牌，16 + 1 = 17 张能成牌就抢金（<b>+8 片</b>）。</li>
        <li><b>庄家也能抢</b>：打完首张手牌同样剩 16 张，条件与闲家完全一样，只是优先级排最后。</li>
        <li>抢的永远是<b>公示金</b>，跟庄家打出的那张牌无关。庄家就算把金打出来，别人也不能拿这张弃牌胡。</li>
        <li>抢金不是点炮，<b>任何牌型都能抢</b>；可以和大牌叠加，唯独不能叠三金倒。</li>
      </ul>
      <p><b>多家同时能抢，谁先抢？</b></p>
      <ul>
        <li>先比<b>叠加的大牌奖励</b>（抢金 8 ＋ 对对胡 / 混一色 / 清一色 / 金雀 / 金龙 / 无花胡），奖励大的先抢。</li>
        <li>奖励一样大 → 按<b>逆时针</b>，从庄家下家开始，<b>庄家最后</b>。</li>
      </ul>
      <span class="hl"><b>抢金压住吃碰杠</b>：这一手只要有人能抢金，别家的吃 / 碰 / 杠一律先挂着。哪怕碰家手快先点了「碰」，也要等所有能抢金的人点「过」，或者直接被抢金胡掉。</span>
      <p class="mini">天胡与抢金互斥：庄家这一手直接成牌就是天胡，没有抢金环节。</p>
    `
  },
  {
    t: '吃 · 碰 · 杠',
    h: `
      <div class="rule-scroll"><table>
        <tr><th>动作</th><th>条件</th><th>朵数</th></tr>
        <tr><td>吃</td><td>只能吃<b>上家</b>打的牌，同一门连着的三张</td><td>—</td></tr>
        <tr><td>碰</td><td>任何人打的牌，你手里有 2 张相同</td><td>—</td></tr>
        <tr><td>明杠</td><td>别人打第 4 张，你手里 3 张</td><td>1 朵</td></tr>
        <tr><td>暗杠</td><td>自己回合，手里 4 张相同</td><td>2 朵</td></tr>
        <tr><td>加杠</td><td>碰过的牌，之后摸到第 4 张</td><td>1 朵</td></tr>
      </table></div>
      <ul>
        <li>杠完从牌尾补 1 张；<b>牌墙空了不能杠</b>。</li>
        <li>副露最多 <b>5 组</b>；满 5 组后不能再吃碰杠，但<b>仍然可以胡</b>（大单调就是 5 组 + 手里 1 张）。</li>
        <li>杠在牌型里只算 3 张，所以杠过之后仍然按 17 张判胡。</li>
      </ul>
      <span class="hl"><b>优先级：胡 &gt; 碰/杠 &gt; 吃。</b>只要有人能胡，别人点的「碰」只是申请，不立即生效；胡家点「过」故意不要，才轮到碰/杠，最后才是吃。所以不会出现「牌都要胡了被人碰走」。</span>
      <ul>
        <li>响应窗口 <b>30 秒</b>不表态自动判「过」。</li>
        <li>多家同时能胡只算一家：从<b>放炮者的下家</b>开始按座位顺序，先轮到的胡。</li>
      </ul>
    `
  },
  {
    t: '胡牌与大牌',
    h: `
      <p><b>牌型</b>：5 组面子 ＋ 1 对将，共 17 张。吃碰杠亮出去的每组都<b>锁定</b>，不能拆回手里重新组合。</p>
      <p><b>自摸 vs 点炮</b>：自摸什么牌型都能胡；<b>点炮只认有奖励的大牌</b>——无花胡、对对胡、金龙、混一色、清一色、大单调（无金）。普通小胡、三金倒、纯金雀、金坎都不能点炮。</p>
      <p><b>抢杠</b>：别人加杠时，你能凑成有奖励的大牌可以抢，<b>杠不成立</b>（退回碰），按<b>他家点炮</b>结算。抢杠本身没有额外奖励。</p>
      <div class="rule-scroll"><table>
        <tr><th>大牌</th><th>奖励</th><th>能否点炮</th></tr>
        <tr><td>天胡</td><td>+8</td><td>只能自摸（仅庄家）</td></tr>
        <tr><td>无花胡</td><td>+8</td><td>可以</td></tr>
        <tr><td>抢金</td><td>+8</td><td>开局窗口</td></tr>
        <tr><td>三金倒</td><td>+10</td><td>只能自摸</td></tr>
        <tr><td>有金对对胡</td><td>+8</td><td>可以</td></tr>
        <tr><td>无金对对胡</td><td>+12</td><td>可以</td></tr>
        <tr><td>金雀（双金作将）</td><td>+12</td><td>自摸 / 抢金</td></tr>
        <tr><td>金坎（卡金位）</td><td>+12</td><td>只能自摸</td></tr>
        <tr><td>大单调（5 副露单钓）</td><td>+12</td><td>无金可以，剩金只能自摸</td></tr>
        <tr><td>金龙（3 金成刻）</td><td>+24</td><td>可以</td></tr>
        <tr><td>混一色</td><td>+24</td><td>可以</td></tr>
        <tr><td>纯清一色</td><td>+48</td><td>可以</td></tr>
      </table></div>
      <p>多个大牌同时成立，<b>片数相加</b>。例：清一色 + 无金对对胡 = 48 + 12 = 60 片，再加基础片。</p>
    `
  },
  {
    t: '怎么算片',
    h: `
      <p><b>第一步：算朵数</b></p>
      <p class="mini">朵数 = 花数 ＋ 明杠×1 ＋ 暗杠×2 ＋ 连庄×1 ＋（自摸且不是大牌 ? 1 : 0）＋（不是 0 花 ? 金的数量 : 0）</p>
      <p><b>第二步：朵数换片</b></p>
      <p>片数 = <b>向上取整（朵数 × 2 ÷ 5）</b>。例：10 朵 → 4 片，11 朵 → 5 片。</p>
      <p><b>第三步：加奖励</b>：大牌奖励直接加在单家应付上。</p>
      <span class="hl"><b>胡家永远收 3 份。</b>自摸三家各付；点炮也是三家各付，<b>放炮的人不多付</b>（这是福麻和很多麻将不一样的地方）。包牌是唯一例外，见下一节。</span>
      <p><b>0 花胡</b>：每张金直接 +1 片（不进朵数），另外再加「无花胡 +8 片」。</p>
      <div class="rule-scroll"><table>
        <tr><th>牌型</th><th>单家应付</th><th>赢家总收</th></tr>
        <tr><td>5 花 + 2 金 + 普通自摸</td><td>4 片</td><td>12 片</td></tr>
        <tr><td>0 花 + 3 金 + 三金倒</td><td>21 片</td><td>63 片</td></tr>
        <tr><td>15 花 + 混一色自摸</td><td>30 片</td><td>90 片</td></tr>
        <tr><td>3 花 + 无金对对胡点炮</td><td>14 片</td><td>42 片</td></tr>
      </table></div>
    `
  },
  {
    t: '包牌：喂牌要负责',
    h: `
      <p>有人做<b>清一色 / 混一色</b>，他每一手吃碰杠都是别人在帮他凑牌型。喂得越多，他做成的概率越大，所以<b>喂牌的人不能和旁观者出一样多</b>。只对清 / 混一色生效，对对胡、金雀等不包。</p>
      <p><b>先看最后一手是谁喂的</b>：都已经吃了三手同花色，还往这个颜色上打，他再吃下去就报听了 —— 这一张的责任最明确，<b>哪怕他总共只喂了这一手，也担一半</b>。</p>
      <p><b>再看是不是同一个人一路喂到底</b>：从头到尾都是他喂的（喂满 4 手以上），这个牌型就是他一手喂成的 → <b>全包</b>。</p>
      <p><b>点炮时，「最后一手」由放炮者扮演</b>：最后那张是他打的，责任归他。</p>
      <div class="rule-scroll"><table>
        <tr><th>情况</th><th>怎么分（总额 = 3 份）</th></tr>
        <tr><td>3 手 · 自摸</td><td>喂最后一手的人一半，另两家各 1/4</td></tr>
        <tr><td>3 手 · 点炮</td><td>放炮者一半，另两家各 1/4</td></tr>
        <tr><td>4 手以上全同一人 · 自摸</td><td>这个人<b>全包</b>，其余两家 0</td></tr>
        <tr><td>4 手以上全同一人 · 别人点炮</td><td>放炮者一半，喂牌的人一半</td></tr>
        <tr><td>4 手以上不同人 · 点炮</td><td>放炮者<b>全包</b>（没人能算「一手喂成」）</td></tr>
      </table></div>
      <p class="mini">例：B 把 A 喂成清一色，C 放炮 50 片/家（总额 150）。3 手时 C 付 75、B 付 37.5、第四家 37.5；如果这 4 手全是 B 喂的，则 C 付 75、B 付 75、第四家 0。</p>
    `
  },
  {
    t: '音效与报牌语音',
    h: `
      <p>牌桌右下角有三个按钮：<b>😀 表情</b>、<b>🔊 音效</b>、<b>语 报牌语音</b>，互不影响，可以只留语音不开音效。</p>
      <ul>
        <li><b>报牌语音</b>：谁打出什么牌就念什么（「三筒」「八万」），吃 / 碰 / 杠 / 暗杠 / 补杠 / 听牌 / 金坎 / 胡都会念。</li>
        <li>胡牌时先念牌型再念胡法，比如「清一色！……自摸！」，大牌会配礼炮和撒金特效。</li>
        <li>女声报牌，念的牌名和牌面上的字<b>完全一致</b>：「三筒」就念三筒。</li>
        <li>语音包随程序一起下载（约 100KB），<b>不用联网、不耗流量</b>；第一次点屏幕就会预加载好，打第一张牌时不会卡。</li>
        <li>嫌吵就点「语」关掉，设置会记住。</li>
      </ul>
    `
  },
  {
    t: '容易踩的坑',
    h: `
      <ul>
        <li><b>打金是安全的</b>：金打出去别人不能吃、碰、点炮。抢金抢的是公示金，跟这张弃牌无关。</li>
        <li><b>报听目前只是标记</b>：不影响算钱，也没有「报听不能改牌」之类的限制。</li>
        <li><b>一炮多响只算一家</b>：从放炮者下家开始按顺序，先轮到的胡，不是一起胡。</li>
        <li><b>金坎一旦宣告，全场只能自摸</b>，谁都不能点炮，也不能再杠。</li>
        <li><b>流局（臭庄）庄家连庄 +1</b>；换牌无效重摇不算一局，不涨连庄。</li>
        <li><b>金坎 / 金雀 / 三金倒</b> 都要求「真的成牌 / 真的有那几张金」，不是凑个样子就算。</li>
      </ul>
    `
  }
];

function buildRules() {
  const body = document.getElementById('rulesBody');
  if (!body || body.dataset.ready) return;
  body.dataset.ready = '1';
  RULE_SECTIONS.forEach((sec, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'rule-sec' + (i === 0 ? ' open' : '');
    const btn = document.createElement('button');
    btn.className = 'rule-h';
    btn.type = 'button';
    btn.innerHTML = `<span class="rule-n">${i + 1}</span><span class="rule-t">${sec.t}</span><span class="rule-arrow">▾</span>`;
    btn.onclick = () => wrap.classList.toggle('open');
    const c = document.createElement('div');
    c.className = 'rule-c';
    c.innerHTML = sec.h;
    wrap.appendChild(btn);
    wrap.appendChild(c);
    body.appendChild(wrap);
  });
}

function toggleRules(show) {
  const m = document.getElementById('rulesModal');
  if (!m) return;
  const on = show == null ? !m.classList.contains('show') : !!show;
  buildRules();
  m.classList.toggle('show', on);
  if (on) {
    const body = document.getElementById('rulesBody');
    if (body) body.scrollTop = 0;
  }
}

(function initRules() {
  const btn = document.getElementById('rulesBtn');
  const close = document.getElementById('rulesClose');
  const modal = document.getElementById('rulesModal');
  if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); toggleRules(true); });
  if (close) close.addEventListener('click', () => toggleRules(false));
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) toggleRules(false); });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      const m = document.getElementById('rulesModal');
      if (m && m.classList.contains('show')) toggleRules(false);
    }
  });
})();

/* ---------------- 从房间返回首页 ---------------- */
let leavingRoom = false;

function backToLobby() {
  if (leavingRoom) return;
  if (state && state.phase !== 'waiting') return;   // 对局进行中不给退，避免把牌局弄散
  leavingRoom = true;
  const btn = document.getElementById('backLobbyBtn');
  if (btn) { btn.disabled = true; btn.textContent = '正在退出…'; }
  if (ws && ws.readyState === 1) {
    try { ws.send(JSON.stringify({ t: 'leave' })); } catch (e) { /* 发不出去就直接走 */ }
  }
  // 服务端没回（断网等）也照样回首页，不让按钮卡住
  setTimeout(() => { if (leavingRoom) finishLeave(); }, 600);
}

function finishLeave() {
  if (!leavingRoom && !state) return;   // 已经回过首页
  leavingRoom = false;
  if (ws) {
    try { ws.onclose = null; ws.onmessage = null; ws.close(); } catch (e) { /* ignore */ }
    ws = null;
  }
  outbox.length = 0;
  state = null;
  mySeat = null;
  swapSelection = [];
  swapSuit = null;
  swapSubmitted = false;
  curSwapId = -1;
  ['waitingPanel', 'swapPanel', 'resultModal'].forEach((id) => setOverlay(id, false));
  const g = document.getElementById('game');
  const l = document.getElementById('lobby');
  if (g) g.classList.remove('active');
  if (l) l.classList.add('active');
  document.body.classList.remove('in-game');
  const hint = document.getElementById('waitHint');
  if (hint) hint.textContent = '';
  const btn = document.getElementById('backLobbyBtn');
  if (btn) { btn.disabled = false; btn.textContent = '返回首页'; }
  const ri = document.getElementById('roomInput');
  if (ri) ri.value = '';
  showMsg('已退出房间，可以重新建房或加入');
  connect();
}

(function initBack() {
  const btn = document.getElementById('backLobbyBtn');
  if (btn) btn.addEventListener('click', (e) => { e.stopPropagation(); backToLobby(); });
})();
