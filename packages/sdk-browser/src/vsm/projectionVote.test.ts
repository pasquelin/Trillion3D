// The projection's subgroup vote (`voteWgsl`, `projectionWgsl.ts`) at subgroup sizes 8 to 128, the
// group's 64 lanes in their subgroups in order or shuffled: every lane's AllTrue is the AND of its
// 32-pixel half — the workgroup counter's vote —, by subgroup where each half lies in one, by the
// counter (the group's whole, `split`) where one does not. The shipped `vsmLaneInit` and
// `vsmVoteAllTrue` run lane by lane, each subgroup operation answered from the predicates its
// subgroup's lanes gave at the same call.
import test from 'node:test';
import assert from 'node:assert/strict';
import { shaderRun } from '../texture/shaderRun.fixture.ts';
import { vsmLayout } from './resources.ts';
import { vsmProjectionWgsl } from './projectionWgsl.ts';
import { seeded } from './planFrames.fixture.ts';

const CODE = vsmProjectionWgsl(vsmLayout({ fullMapCapacity: 7, sunMapCapacity: 3 }, 2 ** 27), {
  subgroups: true,
});
type Vote = {
  vsmLaneInit: (i: number) => void;
  vsmVoteAllTrue: (c: boolean, s: boolean) => boolean;
};

/** The AND of `lane`'s half on vote `j`: the workgroup counter's vote. */
const halfAnd = (votes: boolean[][], lane: number, j: number) =>
  votes[j].slice(lane & 32, (lane & 32) + 32).every(Boolean);

/** Every lane's votes on `votes` (votes[j][lane]) at subgroup size `size`, lane L at position
 *  `place[L]` of the group's subgroups; whether the group split, and the votes it counted. */
function vote(size: number, place: number[], votes: boolean[][]) {
  // Each lane's predicates, call by call: recorded on a first pass, answered after from those of
  // the lanes of its subgroup.
  const asked: boolean[][] = place.map(() => []);
  const mates = (lane: number) =>
    place
      .map((_, other) => other)
      .filter((other) => Math.floor(place[other] / size) === Math.floor(place[lane] / size));
  const ballot = (lane: number, call: number) => {
    const out = [0, 0, 0, 0];
    for (const other of mates(lane))
      if (asked[other][call]) {
        const id = place[other] % size;
        out[id >> 5] = (out[id >> 5] | (1 << (id & 31))) >>> 0;
      }
    return out;
  };
  const any = (lane: number, call: number) => mates(lane).some((other) => asked[other][call]);
  let replay = false,
    split = false,
    counted = 0;
  const lanes = place.map((_, lane) => {
    const state = { call: 0, vote: 0 };
    const ask = (answer: typeof ballot | typeof any) => (c: boolean) => {
      const k = state.call++;
      if (replay) return answer(lane, k);
      asked[lane][k] = c;
      return answer === ballot ? [0, 0, 0, 0] : false;
    };
    const scope = {
      vsmLaneHalf: 0,
      vsmLaneInHalf: 0,
      vsmVoteSerial: 0,
      vsmVoteSplit: 0,
      subgroupBallot: ask(ballot),
      subgroupAny: ask(any),
      atomicOr: (_: unknown, v: number) => void (split ||= v !== 0),
      vsmVoteCounter: () => (counted++, halfAnd(votes, lane, state.vote)),
    };
    return { state, run: shaderRun<Vote>(CODE, ['vsmLaneInit', 'vsmVoteAllTrue'], scope) };
  });
  const pass = (splitAll: boolean) =>
    lanes.map(({ state, run }, lane) => {
      state.call = 0;
      run.vsmLaneInit(lane);
      return votes.map((v, j) => ((state.vote = j), run.vsmVoteAllTrue(v[lane], splitAll)));
    });
  pass(false);
  replay = true;
  split = false;
  pass(false);
  counted = 0;
  const results = pass(split);
  return { results, split, counted };
}

const random = seeded(1663);
/** 40 votes: all true, one lane false, a half false, and random ones of every density. */
const VOTES = Array.from({ length: 40 }, (_, j) =>
  Array.from({ length: 64 }, (_, lane) =>
    j === 0 ? true : j === 1 ? lane !== 37 : j === 2 ? lane >= 32 : random() > (j % 5) * 0.06,
  ),
);

test('every size and order: each lane votes the AND of its half, by subgroup where a half fits', () => {
  const inOrder = Array.from({ length: 64 }, (_, k) => k);
  const shuffled = [...inOrder];
  for (let k = 63; k > 0; k--) {
    const j = Math.floor(random() * (k + 1));
    [shuffled[k], shuffled[j]] = [shuffled[j], shuffled[k]];
  }
  for (const size of [8, 16, 32, 64, 128])
    for (const [order, place] of [
      ['in order', inOrder],
      ['shuffled', shuffled],
    ] as const) {
      const { results, split, counted } = vote(size, place, VOTES);
      for (let lane = 0; lane < 64; lane++)
        for (let j = 0; j < VOTES.length; j++)
          assert.equal(results[lane][j], halfAnd(VOTES, lane, j), `size ${size} ${order} ${lane}`);
      // A half fits one subgroup in order from 32 lanes on, and in any order from 64.
      const fits = size >= 64 || (size === 32 && order === 'in order');
      assert.equal(split, !fits, `size ${size} ${order}`);
      assert.equal(counted, fits ? 0 : 64 * VOTES.length, `size ${size} ${order}`);
    }
});
