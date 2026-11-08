/**
 * 福州麻将联机服务器
 * - Express 托管 public 静态资源
 * - ws 处理房间与实时同步
 */
const express = require('express');
const http = require('http');
const { WebSocketServer } = require('ws');
const path = require('path');
const fs = require('fs');
const { Room } = require('./src/game.js');

const PORT = process.env.PORT || 3000;

// 版本号唯一来源：仓库根目录的 VERSION 文件（每次更新 +1，如 v1 → v2）
const VERSION = (() => {
  try { return fs.readFileSync(path.join(__dirname, 'VERSION'), 'utf8').trim() || 'v1'; }
  catch { return 'v1'; }
})();
const INDEX_HTML = path.join(__dirname, 'public/index.html');
// 把 VERSION 注入页面：<title> 尾部 + 大厅标题旁的版本徽章
function applyVersion(html) {
  return html
    .replace(/(<title>[^<]*?)(\s+v\d+)?(<\/title>)/, `$1 ${VERSION}$3`)
    .replace(/(id="appVer"[^>]*>)[^<]*(?=<)/, `$1${VERSION}`);
}

const app = express();
app.get(['/', '/index.html'], (req, res) => {
  try {
    res.type('html').send(applyVersion(fs.readFileSync(INDEX_HTML, 'utf8')));
  } catch {
    res.status(500).send('index.html 读取失败');
  }
});
app.use(express.static(path.join(__dirname, 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const rooms = new Map(); // roomId -> Room

function genRoomId() {
  let id;
  do { id = Math.random().toString(36).slice(2, 6).toUpperCase(); }
  while (rooms.has(id));
  return id;
}

function send(ws, obj) {
  if (ws && ws.readyState === 1) ws.send(JSON.stringify(obj));
}

wss.on('connection', (ws) => {
  ws.pid = null;
  ws.roomId = null;
  ws.seat = null;

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }
    const { t } = msg;

    if (t === 'create') {
      const roomId = genRoomId();
      const room = new Room(roomId);
      const res = room.addPlayer(ws, msg.name);
      if (!res.ok) { send(ws, { t: 'error', msg: res.msg }); return; }
      rooms.set(roomId, room);
      ws.pid = res.pid; ws.roomId = roomId; ws.seat = res.seat;
      send(ws, { t: 'created', room: roomId, seat: res.seat, pid: res.pid });
      room.broadcast();
      return;
    }

    if (t === 'join') {
      const room = rooms.get(msg.room);
      if (!room) { send(ws, { t: 'error', msg: '房间不存在' }); return; }
      const res = room.addPlayer(ws, msg.name);
      if (!res.ok) { send(ws, { t: 'error', msg: res.msg }); return; }
      ws.pid = res.pid; ws.roomId = msg.room; ws.seat = res.seat;
      send(ws, { t: 'joined', room: msg.room, seat: res.seat, pid: res.pid });
      room.broadcast();
      return;
    }

    const room = ws.roomId ? rooms.get(ws.roomId) : null;
    if (!room) { send(ws, { t: 'error', msg: '未加入房间' }); return; }
    const seat = ws.seat;

    switch (t) {
      case 'leave': {
        // 等待阶段返回首页：让出座位，房间还有人则移交房主
        const r = room.leaveWaiting(ws.pid);
        if (r && !r.ok) { send(ws, { t: 'error', msg: r.msg }); break; }
        ws.roomId = null; ws.seat = null; ws.pid = null;
        send(ws, { t: 'left' });
        if (r.humans === 0) rooms.delete(room.id);   // 真人走光了，房间连同机器人一起回收
        break;
      }
      case 'start':
        if (seat !== 0) { send(ws, { t: 'error', msg: '只有房主能开始' }); break; }
        room.startGame(); // 仅大乱斗模式
        break;
      case 'discard':
        room.discard(seat, msg.tile);
        break;
      case 'claim': {
        let r;
        if (msg.action === 'hu' && !room.pending) {
          // 自家回合摸到可胡(自摸) — 无 pending 时走 selfHu
          r = room.selfHu(seat);
        } else {
          r = room.claim(seat, msg.action, msg.payload);
        }
        if (r && !r.ok) send(ws, { t: 'error', msg: r.msg });
        break;
      }
      case 'hu': {
        // 自摸按钮
        const r = room.selfHu(seat);
        if (r && !r.ok) send(ws, { t: 'error', msg: r.msg });
        break;
      }
      case 'angang': {
        const r = room.anGang(seat, msg.tile);
        if (r && !r.ok) send(ws, { t: 'error', msg: r.msg });
        break;
      }
      case 'bugang': {
        const r = room.buGang(seat, msg.tile);
        if (r && !r.ok) send(ws, { t: 'error', msg: r.msg });
        break;
      }
      case 'swap': {
        const r = room.doSwap(seat, msg.suit, msg.tiles);
        if (r && !r.ok) send(ws, { t: 'error', msg: r.msg });
        break;
      }
      case 'ting': {
        room.declareTing(seat);
        break;
      }
      case 'jinkan': {
        const r = room.declareJinKan(seat);
        if (r && !r.ok) send(ws, { t: 'error', msg: r.msg });
        break;
      }
      case 'emoji': {
        // 快捷表情：广播给全桌，不走 state 快照
        const r = room.sendEmoji(seat, msg.id);
        if (r && !r.ok) send(ws, { t: 'error', msg: r.msg });
        break;
      }
      case 'addBot': {
        if (seat !== 0) { send(ws, { t: 'error', msg: '只有房主能添加机器人' }); break; }
        const r = room.addBot();
        if (r && !r.ok) send(ws, { t: 'error', msg: r.msg });
        break;
      }
      case 'removeBot': {
        if (seat !== 0) { send(ws, { t: 'error', msg: '只有房主能移除机器人' }); break; }
        const r = room.removeBot();
        if (r && !r.ok) send(ws, { t: 'error', msg: r.msg });
        break;
      }
      default:
        break;
    }
  });

  ws.on('close', () => {
    const room = ws.roomId ? rooms.get(ws.roomId) : null;
    if (room) {
      room.removePlayer(ws.pid);
      // 房间空了则清理
      if (room.players.every((p) => !p.connected)) rooms.delete(room.id);
    }
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\n========== 福麻大乱斗学习模拟器 ${VERSION} 联机已启动 ==========`);
  try {
    const { networkInterfaces } = require('os');
    const nets = networkInterfaces();
    const ips = [];
    for (const name of Object.keys(nets)) {
      for (const net of nets[name]) {
        if (net.family === 'IPv4' && !net.internal) ips.push(net.address);
      }
    }
    if (ips.length) {
      console.log(`本机访问:   http://localhost:${PORT}`);
      console.log(`手机访问:   http://${ips[0]}:${PORT}`);
      console.log(`(手机要和电脑连同一个 WiFi，并把这个"手机访问"地址输入手机浏览器)`);
    } else {
      console.log(`访问地址: http://localhost:${PORT} (未检测到局域网 IP)`);
    }
  } catch (e) {
    console.log(`本机访问: http://localhost:${PORT}`);
  }
  console.log(`=============================================\n`);
});
