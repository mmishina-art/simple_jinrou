// ゲームの準備の画面: 人数・名前・役職の数を決める。
import { button, h } from './dom';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROLES,
  ROLE_INFO,
  type Composition,
  compositionError,
  defaultComposition,
  fillVillagers,
  namesError,
  normalizeNames,
} from './logic';

/** 前回の準備（保存して、次も同じメンバーで始めやすくする） */
export interface Setup {
  count: number;
  names: string[];
  comp: Composition;
}

export const defaultSetup = (): Setup => ({ count: 5, names: [], comp: defaultComposition(5) });

/** 保存されていた準備が、使える形か */
export function isSetup(value: unknown): value is Setup {
  const s = value as Partial<Setup> | null;
  return !!s && typeof s.count === 'number' && Array.isArray(s.names) && !!s.comp && compositionError(s.count, s.comp) === null;
}

/** 数を −/＋ で変える行。aria-label で「何の数か」を読み上げる */
function stepper(label: string, value: number, onChange: (v: number) => void, min: number, max: number): HTMLElement {
  return h(
    'div',
    { class: 'stepper' },
    h('span', { class: 'stepper__label' }, label),
    button('−', () => onChange(value - 1), { class: 'stepper__button', 'aria-label': `${label}を減らす`, disabled: value <= min }),
    h('span', { class: 'stepper__value', 'aria-live': 'polite' }, `${value}人`),
    button('＋', () => onChange(value + 1), { class: 'stepper__button', 'aria-label': `${label}を増やす`, disabled: value >= max }),
  );
}

/** 準備の画面を root に出す。始めるとき start(準備, 名前) を呼ぶ */
export function renderSetup(root: HTMLElement, initial: Setup, start: (setup: Setup, names: string[]) => void, back: () => void): void {
  const setup: Setup = { ...initial, names: [...initial.names], comp: { ...initial.comp } };
  const error = h('p', { class: 'error', role: 'alert' });

  const render = (): void => {
    const names = h(
      'ol',
      { class: 'names' },
      ...Array.from({ length: setup.count }, (_, i) =>
        h(
          'li',
          {},
          h('input', {
            type: 'text',
            value: setup.names[i] ?? '',
            placeholder: `プレイヤー${i + 1}`,
            maxLength: 10,
            'aria-label': `${i + 1}人目の名前`,
            oninput: (e: Event) => {
              setup.names[i] = (e.target as HTMLInputElement).value;
            },
          }),
        ),
      ),
    );

    const roles = h(
      'div',
      { class: 'roles' },
      ...ROLES.filter((r) => r !== 'villager').map((r) =>
        stepper(
          `${ROLE_INFO[r].mark} ${ROLE_INFO[r].name}`,
          setup.comp[r],
          (v) => {
            setup.comp = fillVillagers(setup.count, { ...setup.comp, [r]: v });
            render();
          },
          r === 'werewolf' ? 1 : 0,
          setup.count,
        ),
      ),
      h(
        'div',
        { class: 'stepper' },
        h('span', { class: 'stepper__label' }, `${ROLE_INFO.villager.mark} ${ROLE_INFO.villager.name}`),
        h('span', { class: 'stepper__value', id: 'villager-count' }, `${setup.comp.villager}人`),
        h('span', { class: 'muted stepper__note' }, '（残りの人数）'),
      ),
    );

    error.textContent = compositionError(setup.count, setup.comp) ?? '';

    root.replaceChildren(
      h('h2', {}, 'ゲームの準備'),
      h(
        'section',
        { class: 'card' },
        stepper('人数', setup.count, (v) => {
          setup.count = v;
          setup.comp = defaultComposition(v);
          render();
        }, MIN_PLAYERS, MAX_PLAYERS),
        h('p', { class: 'muted small' }, '人数を変えると、役職の数はおすすめに戻ります。'),
      ),
      h('section', { class: 'card' }, h('h3', {}, '名前'), h('p', { class: 'muted small' }, '座っている順に入れると、端末を回しやすくなります。'), names),
      h('section', { class: 'card' }, h('h3', {}, '役職'), roles),
      error,
      h(
        'div',
        { class: 'actions' },
        button('ゲームを始める', () => {
          const list = normalizeNames(Array.from({ length: setup.count }, (_, i) => setup.names[i] ?? ''));
          const problem = compositionError(setup.count, setup.comp) ?? namesError(list);
          if (problem) {
            error.textContent = problem;
            return;
          }
          start({ ...setup, names: setup.names.slice(0, setup.count) }, list);
        }, { class: 'primary', id: 'setup-start' }),
        button('もどる', back),
      ),
    );
  };
  render();
}
