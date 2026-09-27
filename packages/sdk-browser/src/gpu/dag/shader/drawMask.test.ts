// `dagDrawScatter` ranks a drawn page in its block off the block's two draw-mask words, which
// `dagMask` sets with the draw flag and `dagPrepare` clears: the rank must be the sum of the
// block's flags before the page, the walk it replaces, on every flag pattern, whatever the words
// held before the frame. The mask words' place in `work` must be the one `dagWorkLayout`
// allocates. What runs is the kernel's own statements (`wgslScope`), their `&work[…]` read as
// `work[…]`.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isDeepStrictEqual } from 'node:util';
import { DAG_SELECTION_SHADER } from './shader.ts';
import { dagWorkLayout } from './floorWgsl.ts';
import { wgslScope } from '../../../page/cut/wgslPredicate.fixture.ts';
import { wgslConstants } from '../../../page/cut/cutRuleWord.fixture.ts';
import { random } from '../../../page/cut/cutRuleChecks.fixture.ts';

const countOneBits = (word: number) => {
  let n = 0;
  for (let w = word >>> 0; w; w &= w - 1) n++;
  return n;
};

/** The kernel statements the masks go through, `source` given: each one's expressions. */
function sites(source: string) {
  const text = source.replaceAll('&work[', 'work[');
  const find = (pattern: RegExp) => {
    const found = pattern.exec(text);
    if (!found) throw new Error(`WGSL_CALL_SITE_MISSING: ${pattern}`);
    return found;
  };
  const clear = find(/if\(t<blockCount\(\)\)\{([^}]+)\}/)[1];
  return {
    clears: [...clear.matchAll(/atomicStore\(work\[([^;]+?)\],0u\)/g)].map((m) => m[1]),
    set: find(/atomicOr\(work\[([^;]+?)\],([^;]+?)\);drawnAppend/),
    rank: find(/let word=([^;]+);\s*var rank=([^;]+);\s*if\((.+?)\)\{rank=rank\+([^;]+);\}/),
  };
}

/** `dagPrepare`, `dagMask` then `dagDrawScatter` on `flags`: each drawn page's rank in its block. */
function maskRanks(flags: Uint8Array, source = DAG_SELECTION_SHADER) {
  const work = new Uint32Array(dagWorkLayout(Math.ceil(flags.length / 64)).liveCounter + 1);
  const scope = wgslScope(source, {
    ...wgslConstants(source),
    views: [{ clusterCount: flags.length }],
    work,
    countOneBits,
    atomicLoad: (value: number) => value,
  });
  const at = (text: string, locals: string[]) => {
    const node = scope.expression(text, locals);
    return (values: Record<string, number>) => node(values) as number;
  };
  const { clears, set, rank } = sites(source);
  // Whatever the words held last frame, `dagPrepare` clears every mask word.
  work.fill(0xffffffff);
  const blocks = at('blockCount()', [])({});
  for (const clear of clears.map((c) => at(c, ['t'])))
    for (let t = 0; t < blocks; t++) work[clear({ t })] = 0;
  const [word, bit] = [at(set[1], ['i']), at(set[2], ['i'])];
  flags.forEach((f, i) => f && (work[word({ i })] |= bit({ i })));
  const [own, first, second, more] = [1, 2, 3, 4].map((n) => at(rank[n], ['i', 'word']));
  const ranks = new Map<number, number>();
  flags.forEach((f, i) => {
    if (!f) return;
    const w = own({ i });
    ranks.set(i, first({ i, word: w }) + (second({ i, word: w }) ? more({ i, word: w }) : 0));
  });
  return ranks;
}

/** The walk the masks replace: the flags of the block before the page. */
function walkRanks(flags: Uint8Array) {
  const ranks = new Map<number, number>();
  flags.forEach((f, i) => {
    if (!f) return;
    let rank = 0;
    for (let j = i - (i % 64); j < i; j++) rank += flags[j];
    ranks.set(i, rank);
  });
  return ranks;
}

/** Flag patterns on every density and block edge. */
function patterns() {
  const next = random(922),
    out: Uint8Array[] = [];
  for (const count of [1, 31, 32, 33, 63, 64, 65, 127, 128, 129, 1000])
    for (const density of [0, 0.03, 0.5, 0.97, 1])
      out.push(Uint8Array.from({ length: count }, () => (next() < density ? 1 : 0)));
  return out;
}

test('the mask rank is the walked rank, on every density and block edge', () => {
  for (const flags of patterns())
    assert.deepEqual(maskRanks(flags), walkRanks(flags), `${flags.length} pages`);
});

test('a kernel edit to the clear, the set or the rank is caught', () => {
  for (const [from, to] of [
    ['(i&32u)!=0u', '(i&31u)!=0u'],
    ['work[word-1u]', 'work[word+1u]'],
    ['drawMaskWord(t*BLOCK+32u)', 'drawMaskWord(t*BLOCK)'],
    ['atomicOr(&work[drawMaskWord(i)],drawBit(i))', 'atomicOr(&work[drawMaskWord(i)],1u)'],
  ]) {
    const source = DAG_SELECTION_SHADER.replace(from, to);
    assert.notEqual(source, DAG_SELECTION_SHADER, `${from} is not in the kernel`);
    const caught = patterns().some(
      (flags) => !isDeepStrictEqual(maskRanks(flags, source), walkRanks(flags)),
    );
    assert.ok(caught, `${from} → ${to}`);
  }
});

test('the masks sit between the block offsets and the live counter the layout allocates', () => {
  for (const count of [1, 64, 65, 4096, 100_000]) {
    const scope = wgslScope(DAG_SELECTION_SHADER, {
      ...wgslConstants(DAG_SELECTION_SHADER),
      views: [{ clusterCount: count }],
    });
    const fn = (name: string) => scope.fn(name) as (...args: number[]) => number;
    const blocks = fn('blockCount')(),
      base = fn('drawMaskBase')(),
      live = fn('liveCounter')();
    assert.equal(base, 2 * blocks, 'behind the counts and offsets');
    for (let b = 0; b < blocks; b++) {
      assert.equal(fn('drawMaskWord')(b * 64), base + 2 * b, `block ${b}, first half`);
      assert.equal(fn('drawMaskWord')(b * 64 + 32), base + 2 * b + 1, `block ${b}, second half`);
    }
    assert.equal(live, base + 2 * blocks, 'two words per block');
    assert.equal(dagWorkLayout(blocks).liveCounter, live, 'the layout the engine allocates');
  }
});
