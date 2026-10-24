// ゲームの進行の画面（GM の代わり）。1台の端末を、順番に回して使う。
// 人に渡すたびに「○○さんに渡してください」の画面をはさみ、前の人の情報が見えないようにする。
import { button, h } from './dom';
import {
  ROLE_INFO,
  TEAM_NAME,
  type Game,
  type Rng,
  type Team,
  currentActor,
  finishReveal,
  forceWin,
  mediumResult,
  nightAction,
  proceed,
  startVote,
  submitNight,
  submitVote,
  voteTargets,
  votesOfDay,
  winner,
  wolfPartners,
} from './logic';
import { beep } from './sound';

export interface PlayHooks {
  /** 進むたびに呼ぶ（途中から再開できるように保存する） */
  save(game: Game): void;
  /** 勝敗が決まったときに1回呼ぶ */
  finish(game: Game): void;
  /** 結果を読み上げる（aria-live） */
  announce(text: string): void;
  again(): void;
  home(): void;
}

/** 話し合いの時間（秒）の最初の値 */
export const TALK_SECONDS = 180;

const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;

export function createPlay(root: HTMLElement, hooks: PlayHooks, rng: Rng) {
  let game: Game | null = null;
  /** 渡す画面のあと、本人が開いたか */
  let opened = false;
  let selected: number | null = null;
  /** 夜の行動を決めたあとの「確認した」の画面で、次に進む先 */
  let pending: Game | null = null;
  let talkLeft = TALK_SECONDS;
  let timer: ReturnType<typeof setInterval> | undefined;

  const name = (i: number): string => game!.players[i].name;

  const stopTimer = (): void => {
    clearInterval(timer);
    timer = undefined;
  };

  function set(next: Game): void {
    game = next;
    opened = false;
    selected = null;
    pending = null;
    stopTimer();
    if (next.phase.kind === 'day') talkLeft = TALK_SECONDS;
    hooks.save(next);
    if (next.phase.kind === 'end') hooks.finish(next);
    render();
    window.scrollTo(0, 0);
  }

  /** 「○○さんに渡してください」の画面 */
  function passScreen(label: string, actor: number, note?: string): HTMLElement {
    return h(
      'section',
      { class: 'card pass' },
      h('p', { class: 'phase-label' }, label),
      note ? h('p', { class: 'note' }, note) : null,
      h('p', { class: 'pass__icon', 'aria-hidden': 'true' }, '📱'),
      h('p', { class: 'pass__to' }, h('strong', { id: 'pass-name' }, name(actor)), ' さんに渡してください'),
      h('p', { class: 'muted small' }, 'ほかの人に画面が見えないようにしてください。'),
      button(`${name(actor)} です（ひらく）`, () => {
        opened = true;
        beep(520);
        render();
      }, { class: 'primary big', id: 'open-button' }),
    );
  }

  /** 人を選ぶボタンの並び（選んだものは aria-pressed） */
  function choices(targets: number[]): HTMLElement {
    return h(
      'div',
      { class: 'choices', role: 'group', 'aria-label': '人を選ぶ' },
      ...targets.map((t) =>
        button(name(t), () => {
          selected = t;
          render();
        }, { class: 'choice', 'aria-pressed': String(selected === t) }),
      ),
    );
  }

  const decide = (label: string, run: () => void): HTMLButtonElement =>
    button(label, () => {
      beep(660);
      run();
    }, { class: 'primary big', id: 'decide-button', disabled: selected === null });

  const roleLine = (actor: number): HTMLElement => {
    const r = ROLE_INFO[game!.players[actor].role];
    return h('p', { class: 'role-line' }, 'あなたは ', h('strong', {}, `${r.mark} ${r.name}`), ' です');
  };

  function revealView(g: Game, actor: number): HTMLElement[] {
    const r = ROLE_INFO[g.players[actor].role];
    const partners = wolfPartners(g, actor);
    return [
      h(
        'section',
        { class: `card role-card team-${r.team}` },
        h('p', { class: 'phase-label' }, `${name(actor)} さんの役職`),
        h('p', { class: 'role-card__mark', 'aria-hidden': 'true' }, r.mark),
        h('p', { class: 'role-card__name', id: 'role-name' }, r.name),
        h('p', { class: 'role-card__team' }, TEAM_NAME[r.team]),
        h('p', {}, r.description),
        g.players[actor].role === 'werewolf'
          ? h('p', { class: 'note' }, partners.length ? `仲間の人狼: ${partners.map(name).join('、')}` : '人狼は、あなた1人です。')
          : null,
      ),
      button('おぼえた（画面をとじる）', () => set(finishReveal(g)), { class: 'primary big', id: 'done-button' }),
    ];
  }

  function nightView(g: Game, actor: number): HTMLElement[] {
    if (pending) {
      // 決めたあとの画面。占い師だけ、ここで結果がわかる（ほかの人も同じ流れにして、見分けられないようにする）
      const result = g.players[actor].role === 'seer' ? pending.divined.at(-1) : undefined;
      const next = pending;
      return [
        h(
          'section',
          { class: 'card' },
          roleLine(actor),
          result
            ? h('p', { class: 'result', id: 'night-result' }, `${name(result.target)} さんは、`, h('strong', {}, result.wolf ? '🐺 人狼です' : '🙂 人狼ではありません'))
            : h('p', { id: 'night-result' }, '選びました。'),
          h('p', { class: 'muted small' }, '画面をとじて、次の人に渡してください。'),
        ),
        button('確認した（画面をとじる）', () => set(next), { class: 'primary big', id: 'done-button' }),
      ];
    }
    const action = nightAction(g, actor);
    const parts: (HTMLElement | null)[] = [roleLine(actor)];
    if (action.kind === 'attack') {
      parts.push(h('p', {}, '今夜、襲う人を選んでください。'));
      const picks = g.wolfVotes.filter((v) => v.voter !== actor);
      if (picks.length) parts.push(h('p', { class: 'note' }, `仲間の選択: ${picks.map((v) => `${name(v.voter)} → ${name(v.target)}`).join('、')}`));
      const partners = wolfPartners(g, actor).filter((i) => g.players[i].alive);
      if (partners.length) parts.push(h('p', { class: 'muted small' }, `仲間: ${partners.map(name).join('、')}（選択が分かれたら抽選）`));
    } else if (action.kind === 'divine') {
      parts.push(h('p', {}, '今夜、占う人を選んでください。'));
    } else if (action.kind === 'guard') {
      parts.push(h('p', {}, '今夜、守る人を選んでください。'));
    } else {
      if (g.players[actor].role === 'medium') {
        const m = mediumResult(g);
        parts.push(
          m
            ? h('p', { class: 'result' }, `今日処刑された ${name(m.target)} さんは、`, h('strong', {}, m.wolf ? '🐺 人狼でした' : '🙂 人狼ではありませんでした'))
            : h('p', { class: 'result' }, '今日は、まだ処刑された人がいません。'),
        );
      } else {
        parts.push(h('p', {}, action.reason));
      }
      if (g.players[actor].role === 'werewolf') {
        const partners = wolfPartners(g, actor);
        if (partners.length) parts.push(h('p', { class: 'note' }, `仲間の人狼: ${partners.map(name).join('、')}`));
      }
      parts.push(h('p', { class: 'muted small' }, '怪しいと思う人を選んでください（結果には関係しません）。'));
    }
    return [
      h('section', { class: 'card' }, ...parts, choices(action.targets)),
      decide('決定', () => {
        pending = submitNight(g, selected!, rng);
        render();
      }),
    ];
  }

  function aliveList(g: Game): HTMLElement {
    return h(
      'ul',
      { class: 'players' },
      ...g.players.map((p) => h('li', { class: p.alive ? '' : 'dead' }, p.name, p.alive ? null : h('span', { class: 'muted' }, '（死亡）'))),
    );
  }

  function morningView(g: Game, victim: number | null): HTMLElement[] {
    const text = victim === null ? '昨夜は、誰も襲われませんでした。' : `昨夜、${name(victim)} さんが襲われました。`;
    hooks.announce(`${g.day}日目の朝。${text}`);
    return [
      h('section', { class: 'card center' }, h('p', { class: 'phase-label' }, `☀️ ${g.day}日目の朝`), h('p', { class: 'result', id: 'morning-result' }, text), aliveList(g)),
      button(winner(g) ? '結果を見る' : '話し合いをはじめる', () => set(proceed(g)), { class: 'primary big', id: 'next-button' }),
    ];
  }

  function dayView(g: Game): HTMLElement[] {
    const clock = h('p', { class: 'timer', id: 'timer', role: 'timer' }, fmt(talkLeft));
    const toggle = button(timer ? '一時停止' : 'スタート', () => {
      if (timer) {
        stopTimer();
      } else {
        timer = setInterval(() => {
          talkLeft = Math.max(0, talkLeft - 1);
          // 描き直すと要素が変わるので、そのときの表示を探して更新する
          const shown = root.querySelector('#timer');
          if (shown) shown.textContent = fmt(talkLeft);
          if (talkLeft === 0) {
            stopTimer();
            beep(990, 0.4);
            hooks.announce('話し合いの時間になりました');
            render();
          }
        }, 1000);
      }
      render();
    }, { id: 'timer-toggle', disabled: talkLeft === 0 && !timer });
    const adjust = (d: number): void => {
      talkLeft = Math.max(0, talkLeft + d);
      render();
    };
    return [
      h(
        'section',
        { class: 'card center' },
        h('p', { class: 'phase-label' }, `🗣️ ${g.day}日目の昼 — 話し合い`),
        h('p', { class: 'muted small' }, '人狼だと思う人を、みんなで話し合って決めます。'),
        clock,
        talkLeft === 0 ? h('p', { class: 'note' }, '時間になりました') : null,
        h('div', {}, button('−1分', () => adjust(-60), { 'aria-label': '1分減らす' }), toggle, button('＋1分', () => adjust(60), { 'aria-label': '1分増やす' })),
        aliveList(g),
      ),
      button('投票へすすむ', () => set(startVote(g)), { class: 'primary big', id: 'next-button' }),
    ];
  }

  function voteView(g: Game, actor: number): HTMLElement[] {
    return [
      h('section', { class: 'card' }, h('p', {}, `${name(actor)} さん、処刑したい人を選んでください。`), choices(voteTargets(g, actor))),
      decide('投票する', () => set(submitVote(g, selected!, rng))),
    ];
  }

  function executionView(g: Game, target: number, byLot: boolean): HTMLElement[] {
    const rounds = votesOfDay(g, g.day);
    const text = `${byLot ? '決選投票でも同じ票数だったので、抽選で' : '投票の結果、'}${name(target)} さんが処刑されました。`;
    hooks.announce(text);
    return [
      h(
        'section',
        { class: 'card' },
        h('p', { class: 'phase-label' }, `⚖️ ${g.day}日目の投票の結果`),
        ...rounds.map((r) =>
          h('div', { class: 'tally' }, h('h3', {}, r.runoff ? '決選投票' : '投票'), h('ul', {}, ...r.votes.map((v) => h('li', {}, `${name(v.voter)} → ${name(v.target)}`)))),
        ),
        h('p', { class: 'result', id: 'execution-result' }, text),
      ),
      button(winner(g) ? '結果を見る' : '夜になる', () => set(proceed(g)), { class: 'primary big', id: 'next-button' }),
    ];
  }

  function endView(g: Game, team: Team): HTMLElement[] {
    hooks.announce(`${TEAM_NAME[team]}の勝ちです`);
    return [
      h(
        'section',
        { class: `card center team-${team}` },
        h('p', { class: 'end__mark', 'aria-hidden': 'true' }, team === 'village' ? '🌅' : '🐺'),
        h('p', { class: 'end__title', id: 'winner' }, `${TEAM_NAME[team]}の勝ち！`),
        g.debugUsed ? h('p', { class: 'muted small' }, '（デバッグの操作を使ったので、記録には残りません）') : null,
      ),
      h(
        'section',
        { class: 'card' },
        h('h3', {}, '役職'),
        h(
          'ul',
          { class: 'players' },
          ...g.players.map((p) => {
            const r = ROLE_INFO[p.role];
            return h(
              'li',
              { class: p.alive ? '' : 'dead' },
              `${p.name} — ${r.mark} ${r.name}`,
              p.alive ? null : h('span', { class: 'muted' }, '（死亡）'),
              r.team === team ? h('span', { class: 'win-mark' }, '★勝ち') : null,
            );
          }),
        ),
      ),
      h('div', { class: 'actions' }, button('もう一度（同じメンバーで）', hooks.again, { class: 'primary', id: 'again-button' }), button('タイトルへ', hooks.home)),
    ];
  }

  function render(): void {
    if (!game) return;
    const g = game;
    const ph = g.phase;
    const actor = currentActor(g);
    let view: HTMLElement[];
    if (ph.kind === 'reveal') {
      view = opened ? revealView(g, actor!) : [passScreen(`役職の確認（${ph.step + 1} / ${g.players.length}人目）`, actor!)];
    } else if (ph.kind === 'night') {
      view = opened ? nightView(g, actor!) : [passScreen(`🌙 ${g.day}日目の夜（${ph.step + 1} / ${ph.order.length}人目）`, actor!, ph.step === 0 ? '夜になりました。1人ずつ、こっそり行動します。' : undefined)];
    } else if (ph.kind === 'vote') {
      const note = ph.runoff ? `同じ票数の人がいたので、決選投票です（候補: ${ph.candidates.map(name).join('、')}）` : ph.step === 0 ? '1人ずつ、こっそり投票します。' : undefined;
      view = opened ? voteView(g, actor!) : [passScreen(`🗳️ ${g.day}日目の投票（${ph.step + 1} / ${ph.order.length}人目）`, actor!, note)];
    } else if (ph.kind === 'morning') {
      view = morningView(g, ph.victim);
    } else if (ph.kind === 'day') {
      view = dayView(g);
    } else if (ph.kind === 'execution') {
      view = executionView(g, ph.target, ph.byLot);
    } else {
      view = endView(g, ph.winner);
    }
    root.replaceChildren(...view);
  }

  return {
    start: (g: Game): void => set(g),
    stop: (): void => {
      stopTimer();
      game = null;
    },
    /** デバッグ: すぐにその陣営の勝ちにする */
    forceWin: (team: Team): void => {
      if (game && game.phase.kind !== 'end') set(forceWin(game, team));
    },
  };
}
