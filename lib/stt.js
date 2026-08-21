// [음성→텍스트] ffmpeg로 16kHz wav 변환 후 whisper.cpp로 전사(한국어). CPU 전용, 순차 처리 큐.
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BIN = process.env.SECBOT_WHISPER_BIN || '/srv/claude-bot/whisper.cpp/build/bin/whisper-cli';
const MODEL = process.env.SECBOT_WHISPER_MODEL || '/srv/claude-bot/whisper.cpp/models/ggml-small.bin';
const FFMPEG = process.env.FFMPEG_BIN || 'ffmpeg';

function available() {
  return fs.existsSync(BIN) && fs.existsSync(MODEL);
}

function isAudio(mimetype, filetype) {
  const mt = (mimetype || '').toLowerCase();
  const ft = (filetype || '').toLowerCase();
  return mt.startsWith('audio/') || ['m4a', 'mp3', 'wav', 'ogg', 'oga', 'webm', 'mp4', 'aac', 'amr', 'opus', 'flac'].includes(ft);
}

function run(cmd, args, timeoutMs) {
  return new Promise((resolve) => {
    let out = '', err = '', done = false;
    let c;
    try { c = spawn(cmd, args); } catch (e) { return resolve({ code: -1, out, err: e.message }); }
    const fin = (v) => { if (done) return; done = true; clearTimeout(t); resolve(v); };
    const t = timeoutMs ? setTimeout(() => { try { c.kill('SIGKILL'); } catch {} fin({ code: -1, out, err: 'timeout' }); }, timeoutMs) : null;
    c.stdout.on('data', (d) => { out += d; });
    c.stderr.on('data', (d) => { err += d; });
    c.on('error', (e) => fin({ code: -1, out, err: e.message }));
    c.on('close', (code) => fin({ code, out, err }));
  });
}

async function _transcribe(audioPath) {
  if (!available()) return { ok: false, error: 'not_available' };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'secbot-stt-'));
  const wav = path.join(dir, 'a.wav');
  try {
    const f = await run(FFMPEG, ['-y', '-i', audioPath, '-ar', '16000', '-ac', '1', '-f', 'wav', wav], 5 * 60 * 1000);
    if (f.code !== 0 || !fs.existsSync(wav)) return { ok: false, error: 'ffmpeg_fail: ' + (f.err || '').slice(-160) };
    const w = await run(BIN, ['-m', MODEL, '-f', wav, '-l', 'ko', '-nt'], 90 * 60 * 1000);
    if (w.code !== 0) return { ok: false, error: 'whisper_fail: ' + (w.err || '').slice(-160) };
    const text = (w.out || '').replace(/\r/g, '').trim();
    if (!text) return { ok: false, error: 'empty' };
    return { ok: true, text };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch {}
  }
}

// 순차 처리(동시 whisper 실행으로 CPU 과부하 방지)
let chain = Promise.resolve();
function transcribe(audioPath) {
  const p = chain.then(() => _transcribe(audioPath));
  chain = p.then(() => {}, () => {});
  return p;
}

module.exports = { available, isAudio, transcribe };
