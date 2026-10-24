// ルール・計算は DOM に触れない純関数にして、tests/ で単体テストする。
// ゲームの進み具合（誰の番か、も含む）は、すべて Game に入れる。保存して、途中から再開できるようにするため。

export type Role = 'villager' | 'werewolf' | 'seer' | 'knight' | 'medium' | 'madman';
export type Team = 'village' | 'wolf';

/** 画面に並べる順 */
export const ROLES: Role[] = ['werewolf', 'madman', 'seer', 'medium', 'knight', 'villager'];

export const ROLE_INFO: Record<Role, { name: string; mark: string; team: Team; description: string }> = {
  villager: { name: '村人', mark: '🧑‍🌾', team: 'village', description: '特別な力はありません。話し合いで人狼を見つけましょう。' },
  werewolf: {
    name: '人狼',
    mark: '🐺',
    team: 'wolf',
    description: '2日目からの夜に、仲間と1人を選んで襲います。生きている人狼の数が、人間と同じ数になれば勝ちです。',
  },
  seer: { name: '占い師', mark: '🔮', team: 'village', description: '毎晩1人を占って、人狼かどうかを知ることができます。' },
  knight: { name: '騎士', mark: '🛡️', team: 'village', description: '2日目からの夜に、自分以外の1人を、人狼の襲撃から守ります。' },
  medium: { name: '霊媒師', mark: '🕯️', team: 'village', description: '夜に、その日に処刑された人が人狼だったかどうかを知ることができます。' },
  madman: {
    name: '狂人',
    mark: '🃏',
    team: 'wolf',
    description: '人間ですが、人狼の味方です。人狼陣営が勝てば勝ちです。誰が人狼かは知りません。占われると「人狼ではない」と出ます。',
  },
};

export const TEAM_NAME: Record<Team, string> = { village: '村人陣営', wolf: '人狼陣営' };

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = 12;

export type Composition = Record<Role, number>;

/** 人数ごとのおすすめの役職の数（村人は残りの人数） */
export function defaultComposition(n: number): Composition {
  // [人狼, 狂人, 占い師, 霊媒師, 騎士]
  const table: Record<number, number[]> = {
    4: [1, 0, 1, 0, 0],
    5: [1, 1, 1, 0, 0],
    6: [1, 1, 1, 0, 1],
    7: [2, 0, 1, 0, 1],
    8: [2, 0, 1, 1, 1],
    9: [2, 1, 1, 1, 1],
    10: [2, 1, 1, 1, 1],
    11: [3, 1, 1, 1, 1],
    12: [3, 1, 1, 1, 1],
  };
  const [werewolf, madman, seer, medium, knight] = table[Math.min(Math.max(n, MIN_PLAYERS), MAX_PLAYERS)];
  return fillVillagers(n, { werewolf, madman, seer, medium, knight, villager: 0 });
}

/** 村人の数を「人数 − ほかの役職の合計」にする（マイナスになることもある。compositionError で止める） */
export function fillVillagers(n: number, c: Composition): Composition {
  const others = ROLES.filter((r) => r !== 'villager').reduce((sum, r) => sum + c[r], 0);
  return { ...c, villager: n - others };
}

/** 役職の組み合わせが遊べるかを確かめる。だめなら理由、よければ null */
export function compositionError(n: number, c: Composition): string | null {
  if (n < MIN_PLAYERS || n > MAX_PLAYERS) return `人数は ${MIN_PLAYERS}〜${MAX_PLAYERS} 人にしてください`;
  if (ROLES.some((r) => c[r] < 0)) return '役職の数が人数より多くなっています';
  const total = ROLES.reduce((sum, r) => sum + c[r], 0);
  if (total !== n) return `役職の合計（${total}人）が、人数（${n}人）と合いません`;
  if (c.werewolf < 1) return '人狼は1人以上にしてください';
  if (c.werewolf * 2 >= n) return '人狼が多すぎます（人数の半分より少なくしてください）';
  return null;
}

/** 名前の空欄は「プレイヤーN」にする。前後の空白は取る */
export function normalizeNames(names: string[]): string[] {
  return names.map((name, i) => name.trim() || `プレイヤー${i + 1}`);
}

/** 名前に同じものがあれば理由、なければ null（同じ名前だと、だれに渡すかわからなくなる） */
export function namesError(names: string[]): string | null {
  const seen = new Set<string>();
  for (const name of names) {
    if (seen.has(name)) return `同じ名前があります: ${name}`;
    seen.add(name);
  }
  return null;
}

// ---- ゲームの進行 ----

export interface Player {
  name: string;
  role: Role;
  alive: boolean;
}

export type Phase =
  /** 1人ずつ、自分の役職を確認する */
  | { kind: 'reveal'; step: number }
  /** 夜: 生きている人が順番に、自分の行動をする（行動がない人も、怪しい人を選ぶ。ほかの人に見分けられないように） */
  | { kind: 'night'; step: number; order: number[] }
  | { kind: 'morning'; victim: number | null }
  /** 昼: 話し合い */
  | { kind: 'day' }
  /** 投票: 生きている人が順番に投票する。同票なら、その人たちで決選投票（runoff） */
  | { kind: 'vote'; step: number; order: number[]; candidates: number[]; runoff: boolean }
  /** 処刑。byLot: 決選投票でも同票で、抽選になった */
  | { kind: 'execution'; target: number; byLot: boolean }
  | { kind: 'end'; winner: Team };

export interface Vote {
  voter: number;
  target: number;
}

export interface Game {
  players: Player[];
  /** 何日目か。1日目は夜だけ（襲撃なし）。朝になると1つ増える */
  day: number;
  phase: Phase;
  /** 今夜の人狼の選択（仲間どうしで見える） */
  wolfVotes: Vote[];
  /** 今夜、騎士が守る人 */
  guard: number | null;
  /** 占いの結果（占い師だけが見る） */
  divined: { day: number; target: number; wolf: boolean }[];
  /** 処刑された人（霊媒師が見る） */
  executed: { day: number; target: number }[];
  /** 今の投票 */
  votes: Vote[];
  /** これまでの投票（処刑の画面で、だれがだれに入れたかを見せる） */
  voteHistory: { day: number; runoff: boolean; votes: Vote[] }[];
  /** デバッグの操作を使った回（記録を残さない） */
  debugUsed: boolean;
}

export type Rng = () => number;

export function shuffle<T>(items: T[], rng: Rng): T[] {
  const a = [...items];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

const pick = <T>(items: T[], rng: Rng): T => items[Math.floor(rng() * items.length)];

/** 役職を配って、ゲームを始める（names と c は、確かめ済みのもの） */
export function newGame(names: string[], c: Composition, rng: Rng): Game {
  const roles = shuffle(
    ROLES.flatMap((r) => Array<Role>(c[r]).fill(r)),
    rng,
  );
  return {
    players: names.map((name, i) => ({ name, role: roles[i], alive: true })),
    day: 1,
    phase: { kind: 'reveal', step: 0 },
    wolfVotes: [],
    guard: null,
    divined: [],
    executed: [],
    votes: [],
    voteHistory: [],
    debugUsed: false,
  };
}

const alive = (game: Game): number[] => game.players.flatMap((p, i) => (p.alive ? [i] : []));
const isWolf = (game: Game, i: number): boolean => game.players[i].role === 'werewolf';

/** 今、端末を持つ人（役職の確認・夜・投票のとき）。それ以外は null */
export function currentActor(game: Game): number | null {
  const ph = game.phase;
  if (ph.kind === 'reveal') return ph.step;
  if (ph.kind === 'night' || ph.kind === 'vote') return ph.order[ph.step];
  return null;
}

/** 人狼の仲間（自分以外の人狼）。人狼でなければ空 */
export function wolfPartners(game: Game, i: number): number[] {
  if (!isWolf(game, i)) return [];
  return game.players.flatMap((p, j) => (j !== i && p.role === 'werewolf' ? [j] : []));
}

/** 役職の確認を次の人へ。全員終わったら1日目の夜 */
export function finishReveal(game: Game): Game {
  if (game.phase.kind !== 'reveal') return game;
  const step = game.phase.step + 1;
  if (step < game.players.length) return { ...game, phase: { kind: 'reveal', step } };
  return startNight(game);
}

function startNight(game: Game): Game {
  return { ...game, wolfVotes: [], guard: null, phase: { kind: 'night', step: 0, order: alive(game) } };
}

export type NightAction =
  | { kind: 'attack'; targets: number[] }
  | { kind: 'divine'; targets: number[] }
  | { kind: 'guard'; targets: number[] }
  /** 行動がない。targets は、怪しい人を選ぶため（結果には関係しない） */
  | { kind: 'none'; targets: number[]; reason: string };

/** 夜に、その人がすること */
export function nightAction(game: Game, actor: number): NightAction {
  const others = alive(game).filter((i) => i !== actor);
  const role = game.players[actor].role;
  if (role === 'werewolf') {
    if (game.day === 1) return { kind: 'none', targets: others, reason: '1日目の夜は、襲撃しません。' };
    return { kind: 'attack', targets: others.filter((i) => !isWolf(game, i)) };
  }
  if (role === 'seer') return { kind: 'divine', targets: others };
  if (role === 'knight') {
    if (game.day === 1) return { kind: 'none', targets: others, reason: '1日目の夜は、襲撃がないので、守りません。' };
    return { kind: 'guard', targets: others };
  }
  return { kind: 'none', targets: others, reason: '今夜の行動はありません。' };
}

/** 霊媒師が見る、今日処刑された人の結果。処刑がなければ null */
export function mediumResult(game: Game): { target: number; wolf: boolean } | null {
  const e = game.executed.find((x) => x.day === game.day);
  return e ? { target: e.target, wolf: isWolf(game, e.target) } : null;
}

/** 夜の行動を決めて、次の人へ。全員終わったら朝にする */
export function submitNight(game: Game, target: number, rng: Rng): Game {
  if (game.phase.kind !== 'night') return game;
  const actor = currentActor(game)!;
  const action = nightAction(game, actor);
  let next: Game = game;
  if (action.kind === 'attack') next = { ...next, wolfVotes: [...next.wolfVotes, { voter: actor, target }] };
  if (action.kind === 'guard') next = { ...next, guard: target };
  if (action.kind === 'divine') next = { ...next, divined: [...next.divined, { day: game.day, target, wolf: isWolf(game, target) }] };
  const step = game.phase.step + 1;
  if (step < game.phase.order.length) return { ...next, phase: { ...game.phase, step } };
  return resolveNight(next, rng);
}

/** 票の多い人たち（同票なら全員） */
function topVoted(votes: Vote[]): number[] {
  const counts = new Map<number, number>();
  for (const v of votes) counts.set(v.target, (counts.get(v.target) ?? 0) + 1);
  const max = Math.max(...counts.values());
  return [...counts].filter(([, n]) => n === max).map(([t]) => t).sort((a, b) => a - b);
}

function resolveNight(game: Game, rng: Rng): Game {
  let victim: number | null = null;
  // 人狼の選択が分かれたら、多いほう。同数なら抽選
  if (game.wolfVotes.length > 0) victim = pick(topVoted(game.wolfVotes), rng);
  if (victim !== null && victim === game.guard) victim = null;
  const players = game.players.map((p, i) => (i === victim ? { ...p, alive: false } : p));
  return { ...game, players, day: game.day + 1, phase: { kind: 'morning', victim } };
}

/** 勝った陣営。まだ決まらなければ null */
export function winner(game: Game): Team | null {
  const living = alive(game);
  const wolves = living.filter((i) => isWolf(game, i)).length;
  if (wolves === 0) return 'village';
  if (wolves >= living.length - wolves) return 'wolf';
  return null;
}

/** 朝・処刑のあと: 勝敗が決まっていれば終わり、まだなら次（朝 → 話し合い、処刑 → 夜） */
export function proceed(game: Game): Game {
  const kind = game.phase.kind;
  if (kind !== 'morning' && kind !== 'execution') return game;
  const w = winner(game);
  if (w) return { ...game, phase: { kind: 'end', winner: w } };
  return kind === 'morning' ? { ...game, phase: { kind: 'day' } } : startNight(game);
}

/** 話し合いを終えて、投票を始める */
export function startVote(game: Game): Game {
  if (game.phase.kind !== 'day') return game;
  const living = alive(game);
  return { ...game, votes: [], phase: { kind: 'vote', step: 0, order: living, candidates: living, runoff: false } };
}

/** その人が投票できる相手（自分以外の候補） */
export function voteTargets(game: Game, voter: number): number[] {
  return game.phase.kind === 'vote' ? game.phase.candidates.filter((i) => i !== voter) : [];
}

/** 投票して次の人へ。全員終わったら開票する（同票なら決選投票、決選投票でも同票なら抽選） */
export function submitVote(game: Game, target: number, rng: Rng): Game {
  const ph = game.phase;
  if (ph.kind !== 'vote') return game;
  const votes = [...game.votes, { voter: ph.order[ph.step], target }];
  const step = ph.step + 1;
  if (step < ph.order.length) return { ...game, votes, phase: { ...ph, step } };

  const voteHistory = [...game.voteHistory, { day: game.day, runoff: ph.runoff, votes }];
  const top = topVoted(votes);
  if (top.length > 1 && !ph.runoff) {
    return { ...game, votes: [], voteHistory, phase: { kind: 'vote', step: 0, order: ph.order, candidates: top, runoff: true } };
  }
  const executed = top.length === 1 ? top[0] : pick(top, rng);
  const players = game.players.map((p, i) => (i === executed ? { ...p, alive: false } : p));
  return {
    ...game,
    players,
    votes: [],
    voteHistory,
    executed: [...game.executed, { day: game.day, target: executed }],
    phase: { kind: 'execution', target: executed, byLot: top.length > 1 },
  };
}

/** デバッグ用: すぐに、その陣営の勝ちにする（記録は残さない） */
export function forceWin(game: Game, team: Team): Game {
  return { ...game, debugUsed: true, phase: { kind: 'end', winner: team } };
}

/** その日の投票（処刑の画面で見せる） */
export function votesOfDay(game: Game, day: number): { runoff: boolean; votes: Vote[] }[] {
  return game.voteHistory.filter((h) => h.day === day);
}

/** 勝ち負けの記録 */
export interface Stats {
  village: number;
  wolf: number;
}

export function addResult(stats: Stats, team: Team): Stats {
  return { ...stats, [team]: stats[team] + 1 };
}

/** 保存されていた途中のゲームが、使える形か（古い版・壊れたデータで止まらないように） */
export function isGame(value: unknown): value is Game {
  const g = value as Partial<Game> | null;
  return !!g && typeof g === 'object' && Array.isArray(g.players) && typeof g.day === 'number' && !!g.phase && typeof g.phase.kind === 'string' && g.phase.kind !== 'end';
}
