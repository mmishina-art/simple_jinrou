// 画面の一括撮影: 主な画面を、スマホの幅・小さい画面（iPhone SE）・ダークモードで撮って、shots/ に保存する。
// 「画面を変えたら、実際に表示して確認する」（CLAUDE.md）を、コマンド 1 つでできるようにするため。
// 使い方: npm run shots（build してから撮る）→ shots/<大きさ>-<画面>.png と、全部を並べた shots/all.png
// 画面を足すときは、下の SCREENS に足す（open で、その画面まで操作する）。
import { chromium } from '@playwright/test';
import { preview } from 'vite';
import { mkdirSync, rmSync } from 'node:fs';

/** 撮る画面。open は、ページを開いたあと、その画面を出すための操作。 */
/** ゲームの準備から始めて、役職の確認の「渡す」画面まで進む */
const startGame = async (page) => {
  await page.click('#start-button');
  await page.click('#setup-start');
};
/** 全員の役職の確認を済ませて、1日目の夜にする */
const revealAll = async (page) => {
  await startGame(page);
  for (let i = 0; i < 5; i++) {
    await page.click('#open-button');
    await page.click('#done-button');
  }
};
/** 夜の行動を全員ぶん済ませて、朝にする */
const nightAll = async (page) => {
  await revealAll(page);
  for (let i = 0; i < 5; i++) {
    await page.click('#open-button');
    await page.click('.choice');
    await page.click('#decide-button');
    await page.click('#done-button');
  }
};
const SCREENS = [
  { name: 'home' },
  { name: 'install', open: async (page) => page.click('#install-open') },
  { name: 'backup', open: async (page) => page.click('.backup summary') },
  { name: 'setup', open: async (page) => page.click('#start-button') },
  { name: 'pass', open: startGame },
  { name: 'role', open: async (page) => { await startGame(page); await page.click('#open-button'); } },
  { name: 'night', open: async (page) => { await revealAll(page); await page.click('#open-button'); await page.click('.choice'); } },
  { name: 'morning', open: nightAll },
  { name: 'day', open: async (page) => { await nightAll(page); await page.click('#next-button'); } },
  {
    name: 'end',
    open: async (page) => {
      // デバッグモードにして（バージョンを 5 回タップ）、すぐに人狼陣営の勝ちにする
      for (let i = 0; i < 5; i++) await page.click('#version-line');
      await startGame(page);
      await page.click('[aria-label^="すぐに人狼陣営"]');
    },
  },
];

/** 撮る大きさ。dark はダークモード（端末設定に従う配色のアプリで確認する）。このアプリは暗い固定なので撮らない。 */
const SIZES = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'se', width: 375, height: 667 },
];

const OUT = 'shots';
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

const server = await preview({ preview: { port: 4174, strictPort: true }, logLevel: 'warn' });
const url = 'http://localhost:4174/';
// CHROMIUM_PATH: Playwright のブラウザを入れていない環境で、入っている Chromium を使うとき（ふつうは不要。`npx playwright install chromium`）
const browser = await chromium.launch(process.env.CHROMIUM_PATH ? { executablePath: process.env.CHROMIUM_PATH } : {});
const errors = [];
const files = [];
try {
  for (const size of SIZES) {
    // Service Worker は止める（前の撮影のキャッシュが残らないように）。アニメーションは止めて、毎回同じ絵にする
    const context = await browser.newContext({
      viewport: { width: size.width, height: size.height },
      deviceScaleFactor: 2,
      colorScheme: size.dark ? 'dark' : 'light',
      reducedMotion: 'reduce',
      serviceWorkers: 'block',
    });
    for (const screen of SCREENS) {
      const page = await context.newPage();
      page.on('pageerror', (e) => errors.push(`${size.name}/${screen.name}: ${e.message}`));
      // 確認（「途中のゲームを消しますか？」など）は「OK」で進める
      page.on('dialog', (d) => void d.accept());
      await page.goto(url);
      await page.waitForFunction(() => globalThis.__appStarted === true);
      if (screen.open) await screen.open(page);
      await page.waitForTimeout(300);
      const file = `${OUT}/${size.name}-${screen.name}.png`;
      await page.screenshot({ path: file });
      files.push(file);
      await page.close();
    }
    await context.close();
  }
  // 全部を 1 枚に並べる（行 = 大きさ、列 = 画面）。見比べやすいように
  const page = await browser.newPage({ viewport: { width: 400 * SCREENS.length, height: 900 } });
  const { readFileSync } = await import('node:fs');
  const img = (f) => `data:image/png;base64,${readFileSync(f).toString('base64')}`;
  const rows = SIZES.map((s) => `<tr><th>${s.name}</th>${SCREENS.map((sc) => `<td><img src="${img(`${OUT}/${s.name}-${sc.name}.png`)}" width="${s.width}"><br>${sc.name}</td>`).join('')}</tr>`).join('');
  await page.setContent(`<style>body{margin:8px;font:14px sans-serif;background:#888}td{vertical-align:top;text-align:center;padding:4px}img{border:1px solid #333}</style><table>${rows}</table>`);
  await page.screenshot({ path: `${OUT}/all.png`, fullPage: true });
} finally {
  await browser.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}

console.log(`${files.length} 枚を ${OUT}/ に保存した（一覧: ${OUT}/all.png）`);
if (errors.length) {
  console.error(`画面でエラーが出た:\n${errors.join('\n')}`);
  process.exit(1);
}
