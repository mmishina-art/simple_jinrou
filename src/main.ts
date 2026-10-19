import './style.css';
import { initialState, reset, tap } from './logic';
import { setupDebug } from './debug';
import { setupInstallGuide } from './install';
import { setupUpdateBanner } from './pwa';
import { beep, isSoundOn, setSound } from './sound';
import { exportBackup, importBackup, load, migrateStorage, requestPersist, save } from './storage';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

migrateStorage();
let state = initialState(load('best', 0));
/** デバッグの操作を使った回は、記録（最高記録）を残さない（ふつうに遊んだ記録と混ざらないように）。 */
let cheated = false;

function render(): void {
  $('count').textContent = String(state.count);
  $('best').textContent = String(state.best);
  const sound = $('sound-button');
  sound.textContent = isSoundOn() ? '🔊' : '🔇';
  sound.setAttribute('aria-pressed', String(isSoundOn()));
}

$('tap-button').addEventListener('click', () => {
  state = tap(state);
  if (!cheated) save('best', state.best);
  beep();
  render();
});
$('reset-button').addEventListener('click', () => {
  state = reset(state);
  render();
});
$('sound-button').addEventListener('click', () => {
  setSound(!isSoundOn());
  render();
});

$('backup-export').addEventListener('click', () => {
  const blob = new Blob([exportBackup()], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `${__APP_ID__}-backup-${new Date().toISOString().slice(0, 10)}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});
$<HTMLInputElement>('backup-import').addEventListener('change', async (e) => {
  const input = e.target as HTMLInputElement;
  const file = input.files?.[0];
  if (!file) return;
  const message = $('backup-message');
  try {
    const n = importBackup(await file.text());
    state = initialState(load('best', 0));
    render();
    message.textContent = `${n} 件の記録を読み込みました`;
  } catch (err) {
    message.textContent = err instanceof Error ? err.message : '読み込めませんでした';
  }
  input.value = '';
});

$('version').textContent = __APP_VERSION__;
// デバッグモード: バージョンの表示を続けて 5 回タップで切り替え。操作はアプリごとにここで決める（サンプル: 数を +10）
setupDebug($('debug-panel'), $('version-line'), [
  { label: '+10', title: '数を 10 増やす（この回は記録を残さない）', run: () => { cheated = true; state = { ...state, count: state.count + 10 }; render(); } },
]);
requestPersist();
setupUpdateBanner($('update-banner'), $('update-button'));
setupInstallGuide($<HTMLButtonElement>('install-open'), $<HTMLDialogElement>('install-dialog'), $<HTMLButtonElement>('install-now'));
render();

// ここまで来たら起動成功（public/boot.js が見ている）
window.__appStarted = true;
