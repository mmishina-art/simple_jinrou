// アイコンを生成する（標準ライブラリのみ）: npm run icons
// 色・形はここを書き換えて再実行する。PNG を直接編集しない。
// maskable は端末が外側を円や角丸で切り抜くため、図柄を中央 60% に収める。
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';

// 夜空の色に、黄色の三日月
const BG = [0x11, 0x13, 0x1c];
const FG = [0xe9, 0xc4, 0x6a];

function crc32(buf) {
  let c;
  const table = Array.from({ length: 256 }, (_, n) => {
    c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  let crc = 0xffffffff;
  for (const b of buf) crc = table[(crc ^ b) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
}

// size: 一辺(px) / figure: 図柄の大きさ(一辺に対する割合) / fullBleed: 背景を全面に塗る
function png(size, figure, fullBleed) {
  const raw = Buffer.alloc(size * (size * 4 + 1));
  const c = size / 2;
  const half = (size * figure) / 2;
  const radius = size * 0.22;
  for (let y = 0; y < size; y++) {
    const row = y * (size * 4 + 1);
    raw[row] = 0;
    for (let x = 0; x < size; x++) {
      // 角丸の背景（fullBleed のときは全面）
      const dx = Math.max(Math.abs(x - c) - (c - radius), 0);
      const dy = Math.max(Math.abs(y - c) - (c - radius), 0);
      const inBg = fullBleed || dx * dx + dy * dy <= radius * radius;
      // 図柄: 三日月（中央の丸から、右上にずらした丸を切り抜く）
      const r = half * 0.8;
      const inMoon = (x - c) ** 2 + (y - c) ** 2 <= r ** 2;
      const inBite = (x - c - r * 0.45) ** 2 + (y - c + r * 0.3) ** 2 <= (r * 0.85) ** 2;
      const inFg = inMoon && !inBite;
      const px = inFg ? FG : BG;
      const o = row + 1 + x * 4;
      raw[o] = px[0];
      raw[o + 1] = px[1];
      raw[o + 2] = px[2];
      raw[o + 3] = inBg ? 255 : 0;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw)),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

const out = new URL('../public/icons/', import.meta.url);
mkdirSync(out, { recursive: true });
const files = {
  'icon-192.png': png(192, 0.7, false),
  'icon-512.png': png(512, 0.7, false),
  'icon-maskable-512.png': png(512, 0.6, true),
  // apple-touch-icon は iOS が角を丸めるので全面塗りにする
  'apple-touch-icon.png': png(180, 0.7, true),
};
for (const [name, data] of Object.entries(files)) writeFileSync(new URL(name, out), data);

writeFileSync(
  new URL('icon.svg', out),
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><defs><mask id="m"><rect width="512" height="512" fill="#fff"/><circle cx="320" cy="213" r="122" fill="#000"/></mask></defs><rect width="512" height="512" rx="112" fill="#11131c"/><circle cx="256" cy="256" r="143" fill="#e9c46a" mask="url(#m)"/></svg>\n`,
);
console.log('icons generated:', [...Object.keys(files), 'icon.svg'].join(', '));
