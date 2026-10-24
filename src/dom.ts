// 画面の部品を組み立てる小さな関数。文字は textContent で入れる（innerHTML を使わない）。

type Child = Node | string | null | undefined | false;
type Props = Record<string, unknown> & { class?: string };

/** h('button', { class: 'primary', onclick: () => … }, '押す') のように要素を作る */
export function h<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, ...children: Child[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === undefined || value === null || value === false) continue;
    if (key === 'class') el.className = String(value);
    else if (key.startsWith('on') || key in el) (el as unknown as Record<string, unknown>)[key] = value;
    else el.setAttribute(key, String(value));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

/** ボタン（type="button"） */
export const button = (label: string, onclick: () => void, props: Props = {}): HTMLButtonElement => h('button', { type: 'button', onclick, ...props }, label);
