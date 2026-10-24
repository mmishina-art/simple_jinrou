import { describe, expect, it } from 'vitest';
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  ROLES,
  type Composition,
  type Game,
  type Role,
  addResult,
  compositionError,
  currentActor,
  defaultComposition,
  fillVillagers,
  finishReveal,
  forceWin,
  isGame,
  mediumResult,
  namesError,
  newGame,
  nightAction,
  normalizeNames,
  proceed,
  startVote,
  submitNight,
  submitVote,
  voteTargets,
  wolfPartners,
  winner,
} from '../src/logic';

const zero = (): number => 0;

/** 役職を決め打ちしたゲーム（配る順は乱数に頼らない） */
function gameWith(roles: Role[]): Game {
  const g = newGame(
    roles.map((_, i) => `P${i}`),
    { werewolf: 0, madman: 0, seer: 0, medium: 0, knight: 0, villager: roles.length },
    zero,
  );
  return { ...g, players: g.players.map((p, i) => ({ ...p, role: roles[i] })) };
}

/** 役職の確認を全員ぶん済ませる */
function skipReveal(g: Game): Game {
  while (g.phase.kind === 'reveal') g = finishReveal(g);
  return g;
}

/** 夜の行動を、actor → target の表のとおりにする（表にない人は、生きている最初のほかの人を選ぶ） */
function playNight(g: Game, choose: Record<number, number> = {}): Game {
  while (g.phase.kind === 'night') {
    const actor = currentActor(g)!;
    g = submitNight(g, choose[actor] ?? nightAction(g, actor).targets[0], zero);
  }
  return g;
}

/** 全員が target に投票する（target 自身は、ほかの候補に） */
function voteAll(g: Game, target: number): Game {
  while (g.phase.kind === 'vote') {
    const voter = currentActor(g)!;
    g = submitVote(g, voter === target ? voteTargets(g, voter)[0] : target, zero);
  }
  return g;
}

describe('役職の組み合わせ', () => {
  it('すべての人数で、おすすめの組み合わせが遊べる', () => {
    for (let n = MIN_PLAYERS; n <= MAX_PLAYERS; n++) {
      const c = defaultComposition(n);
      expect(compositionError(n, c), `${n}人`).toBeNull();
      expect(ROLES.reduce((s, r) => s + c[r], 0)).toBe(n);
    }
  });

  it('村人は、残りの人数になる', () => {
    expect(fillVillagers(6, { ...defaultComposition(6), seer: 2 }).villager).toBe(1);
  });

  it('人狼がいない・多すぎる・合計が合わない組み合わせは、理由つきで止める', () => {
    const base: Composition = { werewolf: 1, madman: 0, seer: 1, medium: 0, knight: 0, villager: 2 };
    expect(compositionError(4, { ...base, werewolf: 0, villager: 3 })).toContain('1人以上');
    expect(compositionError(4, { ...base, werewolf: 2, villager: 1 })).toContain('多すぎ');
    expect(compositionError(4, { ...base, villager: 3 })).toContain('合いません');
    expect(compositionError(4, fillVillagers(4, { ...base, seer: 4 }))).toContain('人数より多く');
    expect(compositionError(3, base)).toContain('人数は');
  });
});

describe('名前', () => {
  it('空欄は「プレイヤーN」にし、前後の空白を取る', () => {
    expect(normalizeNames([' あ ', '', '  '])).toEqual(['あ', 'プレイヤー2', 'プレイヤー3']);
  });
  it('同じ名前があれば止める', () => {
    expect(namesError(['あ', 'い', 'あ'])).toContain('あ');
    expect(namesError(['あ', 'い'])).toBeNull();
  });
});

describe('役職を配る', () => {
  it('組み合わせのとおりの数だけ配る', () => {
    const c = defaultComposition(9);
    const g = newGame(normalizeNames(Array(9).fill('')), c, Math.random);
    for (const r of ROLES) expect(g.players.filter((p) => p.role === r).length).toBe(c[r]);
    expect(g.players.every((p) => p.alive)).toBe(true);
  });

  it('人狼には仲間の人狼が見え、ほかの人には見えない', () => {
    const g = gameWith(['werewolf', 'werewolf', 'madman', 'villager', 'villager', 'seer', 'villager']);
    expect(wolfPartners(g, 0)).toEqual([1]);
    expect(wolfPartners(g, 2)).toEqual([]);
  });

  it('全員が確認したら、1日目の夜になる', () => {
    const g = skipReveal(gameWith(['werewolf', 'seer', 'villager', 'villager']));
    expect(g.phase).toEqual({ kind: 'night', step: 0, order: [0, 1, 2, 3] });
    expect(g.day).toBe(1);
  });
});

describe('夜', () => {
  it('1日目の夜は襲撃がなく、平和な朝になる', () => {
    let g = skipReveal(gameWith(['werewolf', 'seer', 'knight', 'villager', 'villager']));
    expect(nightAction(g, 0).kind).toBe('none');
    expect(nightAction(g, 2).kind).toBe('none');
    g = playNight(g);
    expect(g.phase).toEqual({ kind: 'morning', victim: null });
    expect(g.day).toBe(2);
  });

  it('占い師は、人狼を人狼と、狂人を人狼ではないと知る', () => {
    let g = skipReveal(gameWith(['werewolf', 'seer', 'madman', 'villager', 'villager']));
    g = playNight(g, { 1: 0 });
    expect(g.divined).toEqual([{ day: 1, target: 0, wolf: true }]);
    g = startVote(proceed(g));
    g = voteAll(g, 3); // 村人を処刑
    g = playNight(proceed(g), { 1: 2, 0: 4 });
    expect(g.divined.at(-1)).toEqual({ day: 2, target: 2, wolf: false });
  });

  it('2日目からは人狼が襲い、選ばれた人が死ぬ（人狼は人狼を選べない）', () => {
    let g = skipReveal(gameWith(['werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'villager']));
    g = voteAll(startVote(proceed(playNight(g))), 6);
    g = proceed(g);
    expect(nightAction(g, 0)).toEqual({ kind: 'attack', targets: [2, 3, 4, 5] });
    g = playNight(g, { 0: 3, 1: 3 });
    expect(g.phase).toEqual({ kind: 'morning', victim: 3 });
    expect(g.players[3].alive).toBe(false);
  });

  it('人狼の選択が分かれたら、抽選で1人', () => {
    let g = skipReveal(gameWith(['werewolf', 'werewolf', 'seer', 'villager', 'villager', 'villager', 'villager']));
    g = proceed(voteAll(startVote(proceed(playNight(g))), 6));
    g = submitNight(g, 3, zero); // 人狼0 → 3
    g = submitNight(g, 4, zero); // 人狼1 → 4
    while (g.phase.kind === 'night') g = submitNight(g, nightAction(g, currentActor(g)!).targets[0], () => 0.99);
    expect(g.phase).toEqual({ kind: 'morning', victim: 4 });
  });

  it('騎士が守った人は、襲われても死なない', () => {
    let g = skipReveal(gameWith(['werewolf', 'knight', 'seer', 'villager', 'villager', 'villager']));
    g = proceed(voteAll(startVote(proceed(playNight(g))), 5));
    expect(nightAction(g, 1).kind).toBe('guard');
    g = playNight(g, { 0: 2, 1: 2 });
    expect(g.phase).toEqual({ kind: 'morning', victim: null });
    expect(g.players[2].alive).toBe(true);
  });

  it('霊媒師は、その日に処刑された人が人狼かを知る', () => {
    let g = skipReveal(gameWith(['werewolf', 'werewolf', 'medium', 'villager', 'villager', 'villager', 'villager']));
    g = proceed(playNight(g));
    expect(mediumResult(g)).toBeNull();
    g = proceed(voteAll(startVote(g), 1));
    expect(mediumResult(g)).toEqual({ target: 1, wolf: true });
  });
});

describe('投票', () => {
  it('自分には投票できない', () => {
    const g = startVote(proceed(playNight(skipReveal(gameWith(['werewolf', 'seer', 'villager', 'villager'])))));
    expect(voteTargets(g, 0)).toEqual([1, 2, 3]);
  });

  it('いちばん票の多い人が処刑される', () => {
    const g = voteAll(startVote(proceed(playNight(skipReveal(gameWith(['werewolf', 'seer', 'villager', 'villager', 'villager']))))), 2);
    expect(g.phase).toEqual({ kind: 'execution', target: 2, byLot: false });
    expect(g.players[2].alive).toBe(false);
    expect(g.executed).toEqual([{ day: 2, target: 2 }]);
  });

  it('同票なら、その人たちで決選投票。決選投票でも同票なら抽選', () => {
    let g = startVote(proceed(playNight(skipReveal(gameWith(['werewolf', 'seer', 'villager', 'villager'])))));
    // 0→1, 1→0, 2→1, 3→0: 0 と 1 が 2 票ずつ
    for (const t of [1, 0, 1, 0]) g = submitVote(g, t, zero);
    expect(g.phase).toMatchObject({ kind: 'vote', runoff: true, candidates: [0, 1], step: 0 });
    expect(voteTargets(g, 0)).toEqual([1]);
    for (const t of [1, 0, 1, 0]) g = submitVote(g, t, () => 0.99);
    expect(g.phase).toEqual({ kind: 'execution', target: 1, byLot: true });
    expect(g.voteHistory.map((h) => h.runoff)).toEqual([false, true]);
  });
});

describe('勝敗', () => {
  it('人狼が全員いなくなったら、村人陣営の勝ち', () => {
    const g = proceed(voteAll(startVote(proceed(playNight(skipReveal(gameWith(['werewolf', 'seer', 'villager', 'villager']))))), 0));
    expect(g.phase).toEqual({ kind: 'end', winner: 'village' });
  });

  it('人狼の数が、人間の数と同じになったら、人狼陣営の勝ち（狂人は人間に数える）', () => {
    const g = gameWith(['werewolf', 'madman', 'villager', 'villager']);
    expect(winner(g)).toBeNull();
    const dead = { ...g, players: g.players.map((p, i) => (i >= 2 ? { ...p, alive: false } : p)) };
    expect(winner(dead)).toBe('wolf');
  });

  it('決まっていなければ、朝 → 話し合い、処刑 → 夜', () => {
    let g = proceed(playNight(skipReveal(gameWith(['werewolf', 'seer', 'villager', 'villager', 'villager']))));
    expect(g.phase.kind).toBe('day');
    g = proceed(voteAll(startVote(g), 2));
    expect(g.phase.kind).toBe('night');
    expect(g.day).toBe(2);
  });

  it('勝ち数を数える', () => {
    expect(addResult({ village: 1, wolf: 2 }, 'wolf')).toEqual({ village: 1, wolf: 3 });
  });

  it('デバッグで勝たせた回は、記録しない印が付く', () => {
    expect(forceWin(gameWith(['werewolf', 'seer', 'villager', 'villager']), 'village')).toMatchObject({ debugUsed: true, phase: { kind: 'end', winner: 'village' } });
  });
});

describe('途中のゲームの保存', () => {
  it('途中のゲームは再開できる形で、終わったゲームや壊れたデータは使わない', () => {
    const g = gameWith(['werewolf', 'seer', 'villager', 'villager']);
    expect(isGame(JSON.parse(JSON.stringify(g)))).toBe(true);
    expect(isGame(forceWin(g, 'wolf'))).toBe(false);
    expect(isGame(null)).toBe(false);
    expect(isGame({ players: 1 })).toBe(false);
  });
});
