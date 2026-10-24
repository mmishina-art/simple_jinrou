import './style.css';
import { h } from './dom';
import { ROLES, ROLE_INFO, TEAM_NAME, type Game, type Stats, addResult, isGame, newGame } from './logic';
import { isDebug, setupDebug } from './debug';
import { setupInstallGuide } from './install';
import { createPlay } from './play';
import { setupUpdateBanner } from './pwa';
import { type Setup, defaultSetup, isSetup, renderSetup } from './setup';
import { beep, isSoundOn, setSound } from './sound';
import { exportBackup, importBackup, load, migrateStorage, remove, requestPersist, save } from './storage';

const $ = <T extends HTMLElement>(id: string): T => {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
};

migrateStorage();

// 保存キー: stats（勝敗の記録）、setup（前回の準備）、game（途中のゲーム。終わったら消す）
const loadStats = (): Stats => ({ village: 0, wolf: 0, ...load<Partial<Stats>>('stats', {}) });
const loadSetup = (): Setup => {
  const s = load<unknown>('setup', null);
  return isSetup(s) ? s : defaultSetup();
};
const loadGame = (): Game | null => {
  const g = load<unknown>('game', null);
  return isGame(g) ? g : null;
};

let stats = loadStats();

type Screen = 'home' | 'setup' | 'play';
function show(screen: Screen): void {
  $('home-screen').hidden = screen !== 'home';
  $('setup-screen').hidden = screen !== 'setup';
  $('play-screen').hidden = screen !== 'play';
  $('quit-button').hidden = screen !== 'play';
  if (screen === 'home') renderHome();
  window.scrollTo(0, 0);
}

function renderHome(): void {
  $('stats').textContent = `これまでの勝敗: ${TEAM_NAME.village} ${stats.village}勝 / ${TEAM_NAME.wolf} ${stats.wolf}勝`;
  $('resume-button').hidden = loadGame() === null;
}

function renderSound(): void {
  const sound = $('sound-button');
  sound.textContent = isSoundOn() ? '🔊' : '🔇';
  sound.setAttribute('aria-pressed', String(isSoundOn()));
}

const play = createPlay(
  $('play-screen'),
  {
    save: (g) => save('game', g),
    finish: (g) => {
      remove('game');
      // デバッグの操作を使った回は、記録を残さない
      if (!g.debugUsed && g.phase.kind === 'end') {
        stats = addResult(stats, g.phase.winner);
        save('stats', stats);
      }
      beep(880, 0.3);
    },
    announce: (text) => {
      $('announce').textContent = text;
    },
    again: () => openSetup(),
    home: () => {
      play.stop();
      show('home');
    },
  },
  Math.random,
);

function openSetup(): void {
  play.stop();
  renderSetup($('setup-screen'), loadSetup(), (setup, names) => {
    save('setup', setup);
    play.start(newGame(names, setup.comp, Math.random));
    show('play');
  }, () => show('home'));
  show('setup');
}

$('start-button').addEventListener('click', () => {
  if (loadGame() && !confirm('途中のゲームがあります。消して、あたらしく始めますか？')) return;
  remove('game');
  openSetup();
});
$('resume-button').addEventListener('click', () => {
  const g = loadGame();
  if (!g) return renderHome();
  play.start(g);
  show('play');
});
$('quit-button').addEventListener('click', () => {
  if (!confirm('ゲームをやめて、タイトルにもどりますか？（このゲームは消えます）')) return;
  remove('game');
  play.stop();
  show('home');
});
$('sound-button').addEventListener('click', () => {
  setSound(!isSoundOn());
  renderSound();
});

$('role-list').replaceChildren(
  ...ROLES.map((r) => {
    const info = ROLE_INFO[r];
    return h('li', {}, h('strong', {}, `${info.mark} ${info.name}`), `（${TEAM_NAME[info.team]}）: ${info.description}`);
  }),
);

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
    stats = loadStats();
    renderHome();
    message.textContent = `${n} 件の記録を読み込みました`;
  } catch (err) {
    message.textContent = err instanceof Error ? err.message : '読み込めませんでした';
  }
  input.value = '';
});

$('version').textContent = __APP_VERSION__;
// デバッグモード: バージョンの表示を続けて 5 回タップで切り替え。ゲーム中に、すぐ勝敗を決められる（その回は記録を残さない）
setupDebug($('debug-panel'), $('version-line'), [
  { label: '村勝', title: 'すぐに村人陣営の勝ちにする（この回は記録を残さない）', run: () => play.forceWin('village') },
  { label: '狼勝', title: 'すぐに人狼陣営の勝ちにする（この回は記録を残さない）', run: () => play.forceWin('wolf') },
], (on) => document.body.classList.toggle('debug-on', on));
// パネルが、画面の下のボタンに重ならないよう、下に余白を足す
document.body.classList.toggle('debug-on', isDebug());
requestPersist();
setupUpdateBanner($('update-banner'), $('update-button'));
setupInstallGuide($<HTMLButtonElement>('install-open'), $<HTMLDialogElement>('install-dialog'), $<HTMLButtonElement>('install-now'));
renderSound();
show('home');

// ここまで来たら起動成功（public/boot.js が見ている）
window.__appStarted = true;
