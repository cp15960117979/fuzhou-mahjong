// 联机冒烟测试: 自启动服务器, 跑 大乱斗 一整局, 验证不崩溃且能自然结束
const { spawn } = require('child_process');
const { WebSocket } = require('ws');

const PORT = 3100;
const URL = `ws://localhost:${PORT}`;

function startServer() {
  return new Promise((resolve, reject) => {
    const srv = spawn('node', ['server.js'], { cwd: __dirname + '/..', env: { ...process.env, PORT: String(PORT) } });
    srv.stderr.on('data', (d) => process.stderr.write('[server] ' + d));
    let out = '';
    const check = (t) => { out += t; if (out.includes('已启动')) resolve(srv); };
    srv.stdout.on('data', (d) => check(d.toString()));
    setTimeout(() => resolve(srv), 1500); // 兜底
  });
}

function sleep(ms){ return new Promise(r=>setTimeout(r,ms)); }

function runGame(srv) {
  return new Promise(async (resolve) => {
    const clients = [];
    let roomId = null, ended = false, steps = 0, finished = false;
    const MAX_STEPS = 900;
    const lastStates = [];

    function newClient(name){
      return new Promise((res)=>{
        const ws = new WebSocket(URL);
        ws.state=null; ws.seat=null; ws.name=name;
        ws.on('open',()=>res(ws));
        ws.on('message',(raw)=>{
          const msg=JSON.parse(raw.toString());
          if(msg.t==='created'){ ws.seat=msg.seat; roomId=msg.room; }
          else if(msg.t==='joined'){ ws.seat=msg.seat; }
          else if(msg.t==='state'){ ws.state=msg.state; onState(ws); }
          else if(msg.t==='error'){ console.log(`    [${name}] error:`,msg.msg); }
        });
      });
    }
    function snd(ws,obj){ if(ws.readyState===1) ws.send(JSON.stringify(obj)); }

    function onState(ws){
      if(ended) return;
      steps++;
      const s=ws.state;
      if(s) lastStates.push({step:steps,phase:s.phase,turn:s.turn,wall:s.wallLeft});
      if(!s) return;
      if(s.phase==='ended'){ ended=true; report(s); finish(); return; }
      if(steps>MAX_STEPS){ console.log('    达到最大步数, 停止'); finish(); return; }
      const acts=s.actions||[];
      const isSelf = s.selfSeat===ws.seat;
      if(!isSelf) return;
      if(acts.length===0) return;
      // 大乱斗换牌: 每家随机选一个花色 (模拟真人, 全同会导致重摇)
      if(s.phase==='swap' && acts.includes('swap:chooseSuit')){
        const suits=['m','s','p'];
        snd(ws,{t:'swap',suit:suits[Math.floor(Math.random()*3)]});
        return;
      }
      if(acts.includes('jinkan')){ /* 金坎对机器人太复杂, 跳过 */ }
      if(acts.includes('hu')){
        // 自摸/点炮统一走 claim-hu (服务端无 pending 时自动转 selfHu)
        snd(ws,{t:'claim',action:'hu',tile:s.lastDiscard?s.lastDiscard.tile:null});
        return;
      }
      if(acts.includes('angang')){ /* 不杠, 简化 */ }
      if(acts.includes('peng')){ snd(ws,{t:'claim',action:'pass',tile:s.lastDiscard.tile}); return; } // 不碰, 让局快走完
      if(acts.includes('gang')){ snd(ws,{t:'claim',action:'pass',tile:s.lastDiscard.tile}); return; }
      if(acts.includes('discard')){ snd(ws,{t:'discard',tile:s.players[ws.seat].hand[0]}); return; }
      if(acts.includes('pass')){ snd(ws,{t:'claim',action:'pass',tile:s.lastDiscard?s.lastDiscard.tile:null}); return; }
    }

    function report(s){
      if(s.winners && s.winners.draw){ console.log(`    结果: 流局 (牌墙剩 ${s.wallLeft})`); }
      else {
        const w=s.winners;
        const total=(w.payers||[]).reduce((a,p)=>a+p.amount,0);
        console.log(`    结果: 座位${w.winner} ${w.zimo?'自摸':'点炮'} ${w.fan}片 (分摊合计${total}片: ${(w.payers||[]).map(p=>p.seat+'付'+p.amount).join(' ')})`);
        console.log(`    明细: ${(w.detail||[]).join(' / ')}`);
      }
    }
    function finish(){
      if(finished) return; finished=true;
      if(!ended){
        console.log('    [诊断] 未自然结束, 末态:');
        lastStates.slice(-6).forEach(x=>console.log('      ',JSON.stringify(x)));
      }
      clients.forEach(c=>c.close());
      setTimeout(()=>resolve(ended), 300);
    }

    console.log('— 联机冒烟: 大乱斗 —');
    const c0=await newClient('甲'); clients.push(c0);
    snd(c0,{t:'create',name:'甲'});
    await sleep(200);
    console.log('    房间码:',roomId);
    for(const n of ['乙','丙','丁']){
      const c=await newClient(n); clients.push(c);
      snd(c,{t:'join',room:roomId,name:n});
      await sleep(150);
    }
    await sleep(200);
    console.log('    人数:',clients.length,' 房主开始');
    snd(c0,{t:'start'});
    setTimeout(()=>{ if(!finished){ console.log('    超时未结束'); finish(); } }, 25000);
  });
}

(async ()=>{
  const srv = await startServer();
  const ok1 = await runGame(srv);
  await sleep(500);
  const ok2 = await runGame(srv);
  console.log('冒烟测试完成 ✓');
  srv.kill();
  process.exit(ok1 && ok2 ? 0 : 1);
})();
