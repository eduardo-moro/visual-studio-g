// Turns test-integration/frames/ (from recording.js) into media/demo.gif with burned-in captions.
// Usage: node test-integration/make-gif.mjs [width=1280] [fps=10]
import { execFileSync } from 'child_process';
import { readdirSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const frames = join(here, 'frames');
const out = join(here, '..', 'media', 'demo.gif');
const width = Number(process.argv[2] ?? 1280);
const fps = Number(process.argv[3] ?? 10);
const font = execFileSync('fc-match', ['-f', '%{file}', 'Noto Sans:bold'], { encoding: 'utf8' });

const files = readdirSync(frames).filter((f) => f.endsWith('.jpg')).sort();
const stamps = files.map((f) => Number(f.replace('.jpg', '')));
const { t0, captions } = JSON.parse(readFileSync(join(frames, 'timeline.json'), 'utf8'));

// ffmpeg concat list: each frame lasts until the next one was captured.
let list = '';
files.forEach((f, i) => {
  const dur = i + 1 < files.length ? (stamps[i + 1] - stamps[i]) / 1000 : 0.1;
  list += `file '${join(frames, f)}'\nduration ${dur.toFixed(3)}\n`;
});
list += `file '${join(frames, files[files.length - 1])}'\n`;
writeFileSync(join(frames, 'list.txt'), list);

// Caption times relative to the first frame. Text goes through files (no filter escaping).
const offset = (t0 - stamps[0]) / 1000;
mkdirSync(join(frames, 'captions'), { recursive: true });
const draw = captions.map((c, i) => {
  const file = join(frames, 'captions', `${i}.txt`);
  writeFileSync(file, c.text);
  const a = ((c.start - t0) / 1000 + offset).toFixed(2);
  const b = ((c.end - t0) / 1000 + offset).toFixed(2);
  return `drawtext=fontfile=${font}:textfile=${file}:fontsize=40:fontcolor=white:box=1:boxcolor=0x0A4F9E@0.88:boxborderw=18:x=(w-text_w)/2:y=h-text_h-48:enable='between(t,${a},${b})'`;
});

const filter = [
  ...draw,
  `fps=${fps}`,
  `scale=${width}:-1:flags=lanczos`,
  'split[a][b]',
  '[a]palettegen=max_colors=192:stats_mode=diff[p]',
  '[b][p]paletteuse=dither=bayer:bayer_scale=4:diff_mode=rectangle',
].join(',');

execFileSync('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', join(frames, 'list.txt'), '-filter_complex', filter, '-loop', '0', out], { stdio: 'inherit' });
const seconds = (stamps[stamps.length - 1] - stamps[0]) / 1000;
console.log(`${out}: ${files.length} quadros, ${seconds.toFixed(1)} s, ${(statSync(out).size / 1e6).toFixed(1)} MB`);
