// #991: `shadowPcf` of the shipped WGSL, run through `shaderRun` with its page reads spied: every
// comparison and sample of a pixel takes the one `reference` it was handed; a neighbour page
// readable in the home page's range is read across the seam, one that is not at the home page's
// nearest texel — beside each edge and at the corner —, and without `taps` nothing is compared.
// Its taps turned by a jitter phase's angle (#1363), every tap still keeps to the pages the edge test
// names (`PCF_EDGE_TEXELS`), and unturned it is what it was.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mulberry32 } from '../../../../../site/examples/kit/random.ts';
import { hash } from './shadowPages.fixture.ts';
import { PAGE, TURN, coordinate, expected, pcfRun, type V } from './shadowPcfRun.fixture.ts';

test('shadowPcf compares every tap at its one reference, a neighbour across the seam only when readable (#991)', () => {
  const r = mulberry32(991),
    seen = new Set<string>();
  for (let i = 0; i < 4000; i++) {
    const lamp = i % 2 === 0,
      pages = 1 + Math.floor(r() * 8),
      home = [0, 1].map(() => (lamp ? Math.floor(r() * pages) : Math.floor(r() * 17) - 8)),
      t = home.map((p) => coordinate(r, p)),
      side = lamp ? pages * PAGE : 0,
      reference = r() * 1.2 - 0.1,
      seed = Math.floor(r() * 2 ** 31),
      readable = (p: V) => hash(seed ^ Math.imul(p[0], 7919) ^ Math.imul(p[1], 104729)) < 0.5,
      angle = i % 4 < 2 ? 0 : r() * 2 * Math.PI;
    TURN.splice(0, 2, Math.cos(angle), Math.sin(angle));
    const want = expected(t, home, side, reference, readable),
      { answer, calls } = pcfRun(readable, {}, t, reference, home, 0x80000000, side, true);
    // Every argument, the one `reference` of each comparison and sample among them.
    assert.deepEqual(calls, want, `t ${t}, home ${home}, side ${side}`);
    assert.equal(answer, (want.through[0][4] as number) * 0.5);
    for (const p of calls.neighbour)
      seen.add(`${p[0] !== home[0]}${p[1] !== home[1]}${readable(p)}`);
    if (!calls.neighbour.length) seen.add('inside');
    if (lamp && t.some((x) => x < 2 || x > side - 2)) seen.add('lamp edge');

    // Without taps: the same pages asked for, nothing compared, no light.
    const dark = pcfRun(readable, {}, t, reference, home, 0x80000000, side, false);
    assert.equal(dark.answer, 0);
    assert.deepEqual(dark.calls, {
      neighbour: want.neighbour,
      compare: [],
      sample: [],
      through: [],
    });
  }
  // Each axis and the corner, readable or not; pixels away from every edge; a lamp face's border.
  assert.equal(seen.size, 8, [...seen].join(' '));
});
