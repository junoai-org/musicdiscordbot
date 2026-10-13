import { spawn } from 'node:child_process';

const YTDLP = process.env.YTDLP_PATH || 'yt-dlp';
const FFMPEG = process.env.FFMPEG_PATH || 'ffmpeg';
const MAX_PLAYLIST = 100;

function runJson(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YTDLP, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', reject);
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(err.trim().split('\n').pop() || `yt-dlp salió con código ${code}`));
      try {
        resolve(JSON.parse(out));
      } catch (e) {
        reject(e);
      }
    });
  });
}

function toTrack(info) {
  return {
    title: info.title || 'Sin título',
    url: info.webpage_url || info.url,
    duration: info.duration ?? null,
  };
}

// Accepts a URL (video or playlist) or free text, which is searched on YouTube.
export async function resolve(query) {
  const isUrl = /^https?:\/\//i.test(query);
  const info = await runJson([
    '--dump-single-json',
    '--flat-playlist',
    '--no-warnings',
    '--playlist-end', String(MAX_PLAYLIST),
    '--',
    isUrl ? query : `ytsearch1:${query}`,
  ]);
  const entries = info.entries ? info.entries.filter(Boolean) : [info];
  return entries.map(toTrack).filter((t) => t.url);
}

// yt-dlp downloads the best audio and ffmpeg repackages it as Ogg Opus,
// which @discordjs/voice can send without encoding anything in Node.
export function createStream(url, onError) {
  const ytdlp = spawn(
    YTDLP,
    ['-f', 'bestaudio/best', '--no-playlist', '--quiet', '--no-warnings', '-o', '-', '--', url],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  const ffmpeg = spawn(
    FFMPEG,
    ['-loglevel', 'error', '-i', 'pipe:0', '-vn', '-c:a', 'libopus', '-b:a', '128k', '-ar', '48000', '-ac', '2', '-f', 'opus', 'pipe:1'],
    { stdio: ['pipe', 'pipe', 'ignore'] },
  );

  let killed = false;
  let err = '';
  ytdlp.stderr.on('data', (d) => (err += d));
  ytdlp.on('error', (e) => !killed && onError?.(e));
  ffmpeg.on('error', (e) => !killed && onError?.(e));
  ytdlp.on('close', (code) => {
    if (code && !killed) onError?.(new Error(err.trim().split('\n').pop() || `yt-dlp salió con código ${code}`));
  });

  // EPIPE is expected when a track is skipped mid-download.
  ffmpeg.stdin.on('error', () => {});
  ytdlp.stdout.on('error', () => {});
  ytdlp.stdout.pipe(ffmpeg.stdin);

  return {
    stream: ffmpeg.stdout,
    kill() {
      killed = true;
      ytdlp.kill('SIGKILL');
      ffmpeg.kill('SIGKILL');
    },
  };
}
