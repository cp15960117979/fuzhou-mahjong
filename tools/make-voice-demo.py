#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成「报牌语音试听」单页：48 段全量试听 + 3 个音色的同一句对比。
输出 /workspace/语音试听.html（内嵌音频，双击即开，不依赖服务器）。"""
import asyncio, base64, json, pathlib, re, subprocess

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path('/workspace/语音试听.html')
TMP = ROOT / 'tools/.voice-compare'

SAMPLES = [
    ('zh-CN-XiaoxiaoNeural', '晓晓 · 女声（当前使用）'),
    ('zh-CN-YunxiNeural', '云希 · 年轻男声'),
    ('zh-CN-YunjianNeural', '云健 · 激情解说男声'),
]
SENTENCE = '三饼，碰！清一色，自摸！'

GROUPS = [
    ('数牌 · 万', ['1m', '2m', '3m', '4m', '5m', '6m', '7m', '8m', '9m']),
    ('数牌 · 条', ['1s', '2s', '3s', '4s', '5s', '6s', '7s', '8s', '9s']),
    ('数牌 · 筒', ['1p', '2p', '3p', '4p', '5p', '6p', '7p', '8p', '9p']),
    ('花与动作', ['hua', 'peng', 'chi', 'gang', 'angang', 'bugang', 'ting', 'jinkan']),
    ('胡牌与牌型', ['hu', 'zimo', 'qiangjin', 'qianggang', 'drawgame',
                 'qingyise', 'hunyise', 'jinlong', 'jinque', 'duidui', 'duidui_jin', 'sanjindao', 'tianhu']),
]
LABEL = {
    '1m': '一万', '2m': '二万', '3m': '三万', '4m': '四万', '5m': '五万', '6m': '六万', '7m': '七万', '8m': '八万', '9m': '九万',
    '1s': '一条', '2s': '二条', '3s': '三条', '4s': '四条', '5s': '五条', '6s': '六条', '7s': '七条', '8s': '八条', '9s': '九条',
    '1p': '一筒', '2p': '二筒', '3p': '三筒', '4p': '四筒', '5p': '五筒', '6p': '六筒', '7p': '七筒', '8p': '八筒', '9p': '九筒',
    'hua': '花', 'peng': '碰', 'chi': '吃', 'gang': '杠', 'angang': '暗杠', 'bugang': '补杠',
    'ting': '听牌', 'jinkan': '金坎', 'hu': '胡', 'zimo': '自摸', 'qiangjin': '抢金',
    'qianggang': '抢杠胡', 'drawgame': '流局', 'qingyise': '清一色', 'hunyise': '混一色',
    'jinlong': '金龙', 'jinque': '金雀', 'duidui': '对对胡', 'duidui_jin': '对对胡有金',
    'sanjindao': '三金倒', 'tianhu': '天胡',
}


async def synth_sample(voice):
    import edge_tts
    dst = TMP / f'{voice}.mp3'
    TMP.mkdir(exist_ok=True)
    if not dst.exists() or dst.stat().st_size < 800:
        await edge_tts.Communicate(SENTENCE, voice, rate='+8%').save(str(dst))
    wav = TMP / f'{voice}.sample.mp3'
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(dst),
                    '-af', 'silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB,areverse,'
                           'silenceremove=start_periods=1:start_duration=0:start_threshold=-45dB,areverse,'
                           'volume=0.78,alimiter=limit=0.85',
                    '-ar', '24000', '-ac', '1', '-b:a', '32k', '-f', 'mp3', str(wav)], check=True)
    return wav


async def main():
    js = (ROOT / 'public/game.js').read_text(encoding='utf-8')
    idx = json.loads(re.search(r'const VOICE_INDEX = (\{.*?\});', js, re.S).group(1))
    b64 = base64.b64encode((ROOT / 'public/voice/voice.mp3').read_bytes()).decode()

    cards = []
    for title, keys in GROUPS:
        chips = ''.join(
            f'<button class="chip" data-k="{k}"><b>{LABEL[k]}</b><i>{k}</i></button>'
            for k in keys)
        cls = 'grid c3' if len(keys) == 9 else 'grid'
        cards.append(f'<section class="card"><h2>{title}</h2><div class="{cls}">{chips}</div></section>')

    cmp_btns = []
    for i, (voice, name) in enumerate(SAMPLES):
        wav = await synth_sample(voice)
        b = base64.b64encode(wav.read_bytes()).decode()
        cmp_btns.append(
            f'<button class="pick" data-i="{i}"><span>{name}</span><em>试听</em>'
            f'<script type="audio/mpeg" class="pcm">{b}</script></button>')

    html = TEMPLATE.replace('__CARDS__', '\n'.join(cards)) \
                   .replace('__INDEX__', json.dumps(idx, separators=(',', ':'))) \
                   .replace('__B64__', b64) \
                   .replace('__CMP__', ''.join(cmp_btns)) \
                   .replace('__SENT__', SENTENCE)
    OUT.write_text(html, encoding='utf-8')
    print(f'{OUT} {OUT.stat().st_size / 1024:.0f} KB')


TEMPLATE = r"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
<title>福麻大乱斗 · 报牌语音试听</title>
<style>
  :root { color-scheme: dark; }
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; }
  body {
    margin: 0; padding: 22px 16px 60px; font-family: -apple-system, "PingFang SC", "Microsoft YaHei", system-ui, sans-serif;
    background: radial-gradient(120% 80% at 50% 0%, #17795a 0%, #0b3f2d 55%, #072a1e 100%);
    color: #eaf7f0; min-height: 100vh;
  }
  header { max-width: 760px; margin: 0 auto 18px; }
  h1 { font-size: 25px; margin: 0 0 6px; letter-spacing: .5px; }
  h1 em { font-style: normal; color: #ffd23f; }
  .sub { margin: 0; font-size: 13px; line-height: 1.7; color: #b8ddcb; }
  .card {
    max-width: 760px; margin: 0 auto 14px; padding: 14px 15px 16px;
    background: rgba(255,255,255,.055); border: 1px solid rgba(255,255,255,.12);
    border-radius: 16px; backdrop-filter: blur(6px);
  }
  h2 { font-size: 13px; margin: 0 0 11px; color: #ffd23f; font-weight: 700; letter-spacing: .5px; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(74px, 1fr)); gap: 8px; }
  .grid.c3 { grid-template-columns: repeat(3, 1fr); max-width: 400px; }
  .chip {
    display: flex; flex-direction: column; align-items: center; gap: 2px;
    padding: 9px 4px 8px; border-radius: 11px; cursor: pointer;
    background: linear-gradient(180deg, #fdfbf3, #efe6d2);
    border: none; color: #1d2a24; box-shadow: 0 3px 0 rgba(0,0,0,.28), 0 5px 12px rgba(0,0,0,.25);
    transition: transform .07s ease, box-shadow .07s ease;
  }
  .chip b { font-size: 15px; letter-spacing: .5px; }
  .chip i { font-style: normal; font-size: 9px; color: #8a8172; letter-spacing: .4px; }
  .chip:active { transform: translateY(2px) scale(.97); box-shadow: 0 1px 0 rgba(0,0,0,.28); }
  .chip.on { background: linear-gradient(180deg, #ffe98a, #ffd23f); }
  .playall {
    max-width: 760px; margin: 0 auto 14px; display: flex; gap: 9px; flex-wrap: wrap;
  }
  .playall button {
    flex: 1 1 150px; padding: 12px 14px; border-radius: 12px; border: 1px solid rgba(255,255,255,.16);
    background: rgba(255,255,255,.1); color: #eaf7f0; font-size: 13px; font-weight: 700; cursor: pointer;
    font-family: inherit;
  }
  .playall button.primary { background: linear-gradient(180deg,#ffd23f,#e6ac12); color: #22060a; border-color: #ffd23f; }
  .pick {
    display: flex; align-items: center; justify-content: space-between; gap: 10px; width: 100%;
    margin-bottom: 8px; padding: 12px 14px; border-radius: 12px; cursor: pointer;
    background: rgba(255,255,255,.08); border: 1px solid rgba(255,255,255,.14); color: #eaf7f0;
    font-size: 13.5px; font-family: inherit; text-align: left;
  }
  .pick:last-of-type { margin-bottom: 0; }
  .pick em { font-style: normal; font-size: 11px; color: #0d3b28; background: #7fe0b0; padding: 3px 9px; border-radius: 20px; font-weight: 700; }
  .pick.on { border-color: #7fe0b0; background: rgba(127,224,176,.14); }
  .hint { max-width: 760px; margin: 0 auto 14px; font-size: 12px; color: #9dc6b3; line-height: 1.8; }
  .hint b { color: #ffd23f; }
  footer { max-width: 760px; margin: 26px auto 0; font-size: 11.5px; color: #7fae99; text-align: center; line-height: 1.9; }
</style>
</head>
<body>
<header>
  <h1>报牌语音 <em>试听</em></h1>
  <p class="sub">点下面的牌名听发音。游戏里谁打出这张牌，桌面上就会念出来。</p>
</header>

<div class="playall">
  <button class="primary" id="seq">▶ 按顺序全部播一遍</button>
  <button id="stop">■ 停</button>
</div>

__CARDS__

<section class="card">
  <h2>音色对比 · 同一句「__SENT__」</h2>
  __CMP__
  <p class="hint" style="margin:12px 0 0">听完告诉我用哪个，我 1 分钟就能换掉整包语音。</p>
</section>

<footer>
  语音由神经网络 TTS 预生成，随程序一起打包（约 100KB）· 不联网也能出声<br />
  语音念的牌名和牌面上的字完全一致
</footer>

<script>
const INDEX = __INDEX__;
const B64 = "__B64__";

const AC = window.AudioContext || window.webkitAudioContext;
let ac = null, buf = null, cur = null;
function ctx() {
  if (!ac) ac = new AC();
  if (ac.state === 'suspended') ac.resume();
  return ac;
}
async function load() {
  if (buf) return buf;
  const bin = atob(B64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  buf = await ctx().decodeAudioData(u8.buffer);
  return buf;
}
function stopAll() {
  if (cur) { try { cur.stop(); } catch (e) {} cur = null; }
  document.querySelectorAll('.chip.on,.pick.on').forEach((el) => el.classList.remove('on'));
}
async function playKey(k, gain) {
  const b = await load();
  const seg = INDEX[k];
  if (!seg) return 0;
  const c = ctx();
  stopAll();
  const s = c.createBufferSource(); s.buffer = b;
  const g = c.createGain();
  g.gain.value = gain == null ? 1 : gain;
  s.connect(g); g.connect(c.destination);
  s.start(c.currentTime + 0.01, seg[0], seg[1]);
  cur = s;
  return seg[1];
}

document.querySelectorAll('.chip').forEach((btn) => {
  btn.addEventListener('click', async () => {
    btn.classList.add('on');
    await playKey(btn.dataset.k);
  });
});

// 顺序连播
let playing = false;
document.getElementById('stop').onclick = () => { playing = false; stopAll(); };
document.getElementById('seq').onclick = async () => {
  if (playing) { playing = false; return; }
  playing = true;
  const keys = Array.from(document.querySelectorAll('.chip')).map((b) => b.dataset.k);
  for (const k of keys) {
    if (!playing) break;
    const el = document.querySelector('.chip[data-k="' + k + '"]');
    document.querySelectorAll('.chip.on').forEach((x) => x.classList.remove('on'));
    if (el) el.classList.add('on');
    const d = await playKey(k);
    await new Promise((r) => setTimeout(r, d * 1000 + 170));
  }
  playing = false;
  document.querySelectorAll('.chip.on').forEach((x) => x.classList.remove('on'));
};

// 音色对比：每块是 base64 的 PCM
document.querySelectorAll('.pick').forEach((btn) => {
  btn.addEventListener('click', async () => {
    document.querySelectorAll('.pick.on').forEach((x) => x.classList.remove('on'));
    btn.classList.add('on');
    const raw = btn.querySelector('.pcm').textContent.trim();
    const bin = atob(raw);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    const c = ctx();
    stopAll();
    const b = await c.decodeAudioData(u8.buffer.slice(0));
    const s = c.createBufferSource(); s.buffer = b;
    const g = c.createGain(); g.gain.value = 1.15;
    s.connect(g); g.connect(c.destination);
    s.start();
    cur = s;
  });
});
window.addEventListener('pointerdown', () => ctx(), { passive: true });
</script>
</body>
</html>
"""

asyncio.run(main())
