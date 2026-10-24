import { readFileSync } from 'node:fs';
import { type Page, expect, test } from '@playwright/test';

// アプリの ID（package.json の name）。保存データのキーの接頭辞になる
const APP_ID = (JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as { name: string }).name;

// 乱数を固定する（役職の配り方が毎回同じになる）
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    let seed = 12345;
    Math.random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
  });
});

/** 4人で始める（名前は A, B, C, D） */
async function start4(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByRole('button', { name: 'あたらしく始める' }).click();
  await page.getByRole('button', { name: '人数を減らす' }).click();
  await expect(page.locator('.stepper__value').first()).toHaveText('4人');
  for (const [i, n] of ['A', 'B', 'C', 'D'].entries()) await page.getByLabel(`${i + 1}人目の名前`).fill(n);
  await page.getByRole('button', { name: 'ゲームを始める' }).click();
}

/** 全員が役職を確認する。名前 → 役職名 を返す */
async function revealAll(page: Page): Promise<Record<string, string>> {
  const roles: Record<string, string> = {};
  for (let i = 0; i < 4; i++) {
    const name = await page.locator('#pass-name').textContent();
    await page.locator('#open-button').click();
    roles[name!] = (await page.locator('#role-name').textContent())!;
    await page.locator('#done-button').click();
  }
  return roles;
}

const choose = (page: Page, name: string) => page.locator('.choice', { hasText: new RegExp(`^${name}$`) }).click();

test('4人で1ゲーム遊べる: 役職の確認 → 夜 → 朝 → 話し合い → 投票 → 村人陣営の勝ち', async ({ page }) => {
  await start4(page);
  const roles = await revealAll(page);
  expect(Object.values(roles).sort()).toEqual(['人狼', '占い師', '村人', '村人']);
  const wolf = Object.keys(roles).find((n) => roles[n] === '人狼')!;

  // 1日目の夜: 占い師は人狼を占う。ほかの人は、怪しい人を選ぶ
  for (let i = 0; i < 4; i++) {
    const name = (await page.locator('#pass-name').textContent())!;
    await page.locator('#open-button').click();
    await expect(page.locator('#decide-button')).toBeDisabled();
    if (roles[name] === '占い師') await choose(page, wolf);
    else await page.locator('.choice').first().click();
    await page.locator('#decide-button').click();
    if (roles[name] === '占い師') await expect(page.locator('#night-result')).toContainText(`${wolf} さんは、🐺 人狼です`);
    await page.locator('#done-button').click();
  }

  // 朝: 1日目の夜は襲撃なし
  await expect(page.locator('#morning-result')).toHaveText('昨夜は、誰も襲われませんでした。');
  await page.getByRole('button', { name: '話し合いをはじめる' }).click();
  await expect(page.locator('#timer')).toHaveText('3:00');
  await page.getByRole('button', { name: '投票へすすむ' }).click();

  // 投票: みんなで人狼に入れる（人狼は、ほかの人に）
  for (let i = 0; i < 4; i++) {
    const name = (await page.locator('#pass-name').textContent())!;
    await page.locator('#open-button').click();
    if (name === wolf) await page.locator('.choice').first().click();
    else await choose(page, wolf);
    await page.getByRole('button', { name: '投票する' }).click();
  }
  await expect(page.locator('#execution-result')).toContainText(`${wolf} さんが処刑されました`);
  await page.getByRole('button', { name: '結果を見る' }).click();
  await expect(page.locator('#winner')).toHaveText('村人陣営の勝ち！');

  // 勝敗が記録に残る
  await page.getByRole('button', { name: 'タイトルへ' }).click();
  await expect(page.locator('#stats')).toContainText('村人陣営 1勝');
  await expect(page.getByRole('button', { name: '続きから' })).toBeHidden();
});

test('人狼には、人狼であることと、行動の説明が見える', async ({ page }) => {
  await start4(page);
  const roles = await revealAll(page);
  expect(Object.values(roles)).toContain('人狼');
  // 1日目の夜、人狼の番の画面
  for (let i = 0; i < 4; i++) {
    const name = (await page.locator('#pass-name').textContent())!;
    await page.locator('#open-button').click();
    if (roles[name] === '人狼') {
      await expect(page.getByText('1日目の夜は、襲撃しません。')).toBeVisible();
      return;
    }
    await page.locator('.choice').first().click();
    await page.locator('#decide-button').click();
    await page.locator('#done-button').click();
  }
  throw new Error('人狼の番が来なかった');
});

test('人狼が多すぎる組み合わせでは、理由が出て始められない', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'あたらしく始める' }).click();
  await page.getByRole('button', { name: '人数を減らす' }).click();
  await page.getByRole('button', { name: '🐺 人狼を増やす' }).click();
  await expect(page.getByRole('alert')).toContainText('人狼が多すぎます');
  await page.getByRole('button', { name: 'ゲームを始める' }).click();
  await expect(page.locator('#setup-screen')).toBeVisible();
});

test('同じ名前があると、始められない', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'あたらしく始める' }).click();
  await page.getByLabel('1人目の名前').fill('たろう');
  await page.getByLabel('2人目の名前').fill('たろう');
  await page.getByRole('button', { name: 'ゲームを始める' }).click();
  await expect(page.getByRole('alert')).toContainText('同じ名前があります');
});

test('途中で閉じても、続きから再開できる。やめると消える', async ({ page }) => {
  await start4(page);
  await page.locator('#open-button').click();
  await page.locator('#done-button').click();
  const next = await page.locator('#pass-name').textContent();

  await page.reload();
  await page.getByRole('button', { name: '続きから' }).click();
  await expect(page.locator('#pass-name')).toHaveText(next!);

  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'やめる' }).click();
  await expect(page.locator('#home-screen')).toBeVisible();
  await expect(page.getByRole('button', { name: '続きから' })).toBeHidden();
});

test('音のオン/オフを切り替えられる', async ({ page }) => {
  await page.goto('/');
  const button = page.locator('#sound-button');
  await expect(button).toHaveAttribute('aria-pressed', 'true');
  await button.click();
  await expect(button).toHaveAttribute('aria-pressed', 'false');
});

test('manifest と Service Worker が使える', async ({ page }) => {
  await page.goto('/');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  expect(href).toBeTruthy();
  const registered = await page.evaluate(async () => {
    const reg = await navigator.serviceWorker.ready;
    return !!reg.active;
  });
  expect(registered).toBe(true);
});

test('更新バナーは通常は隠れている', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#update-banner')).toBeHidden();
});

test('最初の画面からインストール方法を開ける（使っている端末の説明が開いている）', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /インストールする方法/ }).click();
  const dialog = page.locator('#install-dialog');
  await expect(dialog).toBeVisible();
  // Pixel 7 のプロファイルなので Android の説明が開いている
  await expect(dialog.locator('details[data-platform="android"]')).toHaveJSProperty('open', true);
  await expect(dialog.locator('details[data-platform="ios"]')).toHaveJSProperty('open', false);
  await expect(dialog.getByText('ホーム画面に追加', { exact: false }).first()).toBeVisible();
  await dialog.getByRole('button', { name: 'とじる' }).click();
  await expect(dialog).toBeHidden();
});

test('最初の画面にバージョンが表示される', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#version')).toHaveText(/^\d+\.\d+\.\d+$/);
});

test('記録をファイルに書き出し、消えたあとに読み込んで戻せる', async ({ page }) => {
  await page.goto('/');
  await page.evaluate((id) => localStorage.setItem(`${id}-stats`, JSON.stringify({ village: 2, wolf: 1 })), APP_ID);
  await page.reload();
  await expect(page.locator('#stats')).toContainText('村人陣営 2勝 / 人狼陣営 1勝');
  await page.getByText('記録のバックアップ').click();

  const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'ファイルに書き出す' }).click()]);
  const path = await download.path();
  const text = readFileSync(path, 'utf8');
  expect(JSON.parse(JSON.parse(text).data[`${APP_ID}-stats`])).toEqual({ village: 2, wolf: 1 });

  // 記録を消す → 読み込んで戻す
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await expect(page.locator('#stats')).toContainText('村人陣営 0勝');
  await page.getByText('記録のバックアップ').click();
  await page.locator('#backup-import').setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: Buffer.from(text) });
  await expect(page.locator('#stats')).toContainText('村人陣営 2勝 / 人狼陣営 1勝');
  await expect(page.locator('#backup-message')).toContainText('読み込みました');
});

test('おかしいバックアップファイルは、理由を表示して読み込まない', async ({ page }) => {
  await page.goto('/');
  await page.getByText('記録のバックアップ').click();
  await page.locator('#backup-import').setInputFiles({ name: 'bad.json', mimeType: 'application/json', buffer: Buffer.from('{"app":"other"}') });
  await expect(page.locator('#backup-message')).toContainText('このアプリのバックアップではありません');
  await expect(page.locator('#stats')).toContainText('村人陣営 0勝');
});

test('起動できないときは「なおす」ボタンが出て、押すと起動できる（記録と、ほかのアプリのキャッシュは消えない）', async ({ page }) => {
  await page.addInitScript((id) => {
    (window as unknown as { __bootWaitMs: number }).__bootWaitMs = 500;
    // 1回目の自動修復は済んだことにして、ボタンが出る側の動きを確かめる
    sessionStorage.setItem(`${id}:repaired-at`, String(Date.now()));
    if (!localStorage.getItem(`${id}-stats`)) localStorage.setItem(`${id}-stats`, JSON.stringify({ village: 5, wolf: 0 }));
  }, APP_ID);
  // 同じサイトにある、ほかのアプリのキャッシュ（なおすときに消えてはいけない）を用意する
  await page.goto('/');
  await page.evaluate(async () => { await caches.open('other-app-v1'); });
  // メインのスクリプトが読み込めない状況を作る
  await page.route('**/assets/*.js', (route) => route.abort());
  await page.goto('/');
  await expect(page.locator('#boot-error')).toBeVisible();

  await page.unroute('**/assets/*.js');
  await page.getByRole('button', { name: 'なおす' }).click();
  await expect(page.locator('#stats')).toContainText('村人陣営 5勝');
  await expect(page.locator('#boot-error')).toBeHidden();
  // このアプリのキャッシュだけが作り直され、ほかのアプリのキャッシュは残っている
  expect(await page.evaluate(() => caches.has('other-app-v1'))).toBe(true);
});

test('デバッグモード: バージョンを 5 回タップで操作パネルが出て、使った回は記録を残さない', async ({ page }) => {
  await page.goto('/');
  const panel = page.locator('#debug-panel');
  await expect(panel).toBeHidden();
  for (let i = 0; i < 5; i++) await page.locator('#version-line').click();
  await expect(panel).toBeVisible();

  await page.getByRole('button', { name: 'あたらしく始める' }).click();
  await page.getByRole('button', { name: 'ゲームを始める' }).click();
  await page.getByRole('button', { name: 'すぐに村人陣営の勝ちにする（この回は記録を残さない）' }).click();
  await expect(page.locator('#winner')).toHaveText('村人陣営の勝ち！');
  await page.getByRole('button', { name: 'タイトルへ' }).click();
  await expect(page.locator('#stats')).toContainText('村人陣営 0勝'); // デバッグを使った回の記録は残らない

  await page.reload();
  await expect(panel).toBeVisible(); // オン/オフは保存される
  await page.getByRole('button', { name: 'デバッグモードを終える' }).click();
  await expect(panel).toBeHidden();
});
