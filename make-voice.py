#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""生成麻将语音包：47 段中文报牌，拼成一条 mp3 + 时间索引。

用法：python3 tools/make-voice.py [voice]
默认音色 zh-CN-XiaoxiaoNeural（晓晓，女声），可换 zh-CN-YunxiNeural / zh-CN-YunjianNeural。
产物：public/voice/voice.mp3（单条精灵）+ 自动回写 public/game.js 里的 VOICE_INDEX。
"""
import asyncio, json, os, pathlib, re, shutil, subprocess, sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
RAW = ROOT / 'tools/.voice-raw'
OUT_DIR = ROOT / 'public/voice'
VOICE = sys.argv[1] if len(sys.argv) > 1 else 'zh-CN-XiaoxiaoNeural'
RATE = '+8%'
TAIL_MS = 70          # 每段尾部补静音，避免前一段尾音吃掉后一段开头
BITRATE = '32k'

# key -> 要念的中文。key 与前端 Sound.say(key) 一一对应
WORDS = [
    # 数牌 27
    ('1m', '一万'), ('2m', '二万'), ('3m', '三万'), ('4m', '四万'), ('5m', '五万'),
    ('6m', '六万'), ('7m', '七万'), ('8m', '八万'), ('9m', '九万'),
    ('1s', '一条'), ('2s', '二条'), ('3s', '三条'), ('4s', '四条'), ('5s', '五条'),
    ('6s', '六条'), ('7s', '七条'), ('8s', '八条'), ('9s', '九条'),
    ('1p', '一筒'), ('2p', '二筒'), ('3p', '三筒'), ('4p', '四筒'), ('5p', '五筒'),
    ('6p', '六筒'), ('7p', '七筒'), ('8p', '八筒'), ('9p', '九筒'),
    # 花
    ('hua', '花'),
    # 动作
    ('peng', '碰！'), ('chi', '吃！'), ('gang', '杠！'),
    ('angang', '暗杠！'), ('bugang', '补杠！'),
    ('ting', '听牌'), ('jinkan', '金坎！'),
    ('hu', '胡！'), ('zimo', '自摸！'),
    ('qiangjin', '抢金！'), ('qianggang', '抢杠胡！'),
    ('drawgame', '流局'),
    # 牌型
    ('qingyise', '清一色！'), ('hunyise', '混一色！'),
    ('jinlong', '金龙！'), ('jinque', '金雀！'),
    ('duidui', '对对胡！'), ('duidui_jin', '对对胡，有金！'),
    ('sanjindao', '三金倒！'), ('tianhu', '天胡！'),
]


def ff(*args):
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *args], check=True)


async def synth(key, text, sem):
    import edge_tts
    dst = RAW / f'{key}.mp3'
    if dst.exists() and dst.stat().st_size > 800:
        return
    for attempt in range(4):
        try:
            async with sem:
                c = edge_tts.Communicate(text, VOICE, rate=RATE)
                await c.save(str(dst))
            if dst.exists() and dst.stat().st_size > 800:
                print(f'  ✓ {key:12s} {text}')
                return
        except Exception as e:                      # 网络抖动就重试
            print(f'  ! {key} 第 {attempt + 1} 次失败：{e}')
            await asyncio.sleep(1.2 * (attempt + 1))
    raise RuntimeError(f'{key} 合成失败')


def duration(path):
    out = subprocess.run(
        ['ffprobe', '-v', 'error', '-show_entries', 'format=duration',
         '-of', 'default=nw=1:nk=1', str(path)],
        capture_output=True, text=True, check=True).stdout.strip()
    return float(out)


async def main():
    RAW.mkdir(parents=True, exist_ok=True)
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    sem = asyncio.Semaphore(4)
    await asyncio.gather(*(synth(k, t, sem) for k, t in WORDS))

    # 统一转码成 wav（PCM 才能按采样点精确拼接，mp3 逐段拼会产生帧对齐误差）
    norm = RAW / 'norm'
    norm.mkdir(exist_ok=True)
    import wave
    for key, _ in WORDS:
        ff('-i', str(RAW / f'{key}.mp3'),
           '-af', ('silenceremove=start_periods=1:start_duration=0:start_threshold=-40dB,'
                   'areverse,'
                   'silenceremove=start_periods=1:start_duration=0:start_threshold=-40dB,'
                   'areverse,'
                   'volume=0.72,alimiter=limit=0.85:attack=3:release=50,'
                   'afade=t=in:d=0.006,'
                   f'apad=pad_dur={TAIL_MS / 1000}'),
           '-ar', '24000', '-ac', '1', '-c:a', 'pcm_s16le',
           str(norm / f'{key}.wav'))

    # 按采样点拼成一条
    idx, t, frames = {}, 0.0, []
    for key, _ in WORDS:
        with wave.open(str(norm / f'{key}.wav'), 'rb') as w:
            data = w.readframes(w.getnframes())
            n = w.getnframes()
            rate = w.getframerate()
        d = round(n / rate, 3)
        idx[key] = [round(t, 3), d]
        t += d
        frames.append(data)

    sprite_wav = RAW / 'sprite.wav'
    with wave.open(str(sprite_wav), 'wb') as w:
        w.setnchannels(1); w.setsampwidth(2); w.setframerate(24000)
        w.writeframes(b''.join(frames))

    sprite = OUT_DIR / 'voice.mp3'
    ff('-i', str(sprite_wav), '-ar', '24000', '-ac', '1', '-b:a', BITRATE, str(sprite))

    total = t
    print(f'\n精灵时长 {total:.2f}s，{sprite.stat().st_size / 1024:.0f} KB，{len(idx)} 段')

    # 回写 game.js 的索引块
    js = (ROOT / 'public/game.js').read_text(encoding='utf-8')
    block = ('/*VOICE_INDEX_BEGIN*/\nconst VOICE_INDEX = ' +
             json.dumps(idx, ensure_ascii=False, separators=(',', ':')) +
             ';\n/*VOICE_INDEX_END*/')
    js2, n = re.subn(r'/\*VOICE_INDEX_BEGIN\*/.*?/\*VOICE_INDEX_END\*/', block, js, flags=re.S)
    if n:
        (ROOT / 'public/game.js').write_text(js2, encoding='utf-8')
        print('已更新 public/game.js 的 VOICE_INDEX')
    else:
        print('⚠ game.js 里没找到 /*VOICE_INDEX_BEGIN*/ 占位，索引未写入')


asyncio.run(main())
