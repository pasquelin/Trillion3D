// The opaque resolve reads the transmission alone, as the point read did (`vsmFilteredRead.test.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Mat } from '../../texture/shaderRun.fixture.ts';
import { functionText } from '../../bounce/wgslBody.fixture.ts';
import { directShadowWgsl } from './shadowWgsl.ts';
import { type V, PAGE, LEVEL, MAP, World, run } from './vsmFilteredRead.fixture.ts';
import { pagedSample } from './vsmFilteredSample.fixture.ts';

/** The opaque resolve's read (`shadowFactor` over the mask), as shipped and as it stood: the point
 *  read run whole for its transmission alone. */
const RESOLVE = `${directShadowWgsl(14, 25)}
fn testTransmission()->vec3f{return shadowTransmission;}`;
const READ_TRANSMISSION = '{vsmTransmissionRead(u32(slice)>>6u,isSun(light),P,N);}';
const RESOLVE_BEFORE = RESOLVE.replace(
  READ_TRANSMISSION,
  '{_=vsmShadowFactor(u32(slice)>>6u,isSun(light),P,N);}',
);
const RESOLVE_READ = [
  'shadowFactor',
  'vsmTranslucentCasters',
  'vsmTransmissionRead',
  'vsmShadowFactor',
  'vsmConsumerSlope',
  'vsmConsumerSlopeBias',
  'vsmConsumerSlopeBiasAt',
  'testTransmission',
];
type Resolve = { shadowFactor: (...a: unknown[]) => number; testTransmission: () => V };

test('the resolve reads the transmission alone, as the point read did, bit for bit', () => {
  assert.notEqual(RESOLVE_BEFORE, RESOLVE, 'the resolve calls the transmission read');
  const read = functionText(RESOLVE, 'vsmTransmissionRead');
  assert.doesNotMatch(read, /sm\.depth|vsmConsumerSlopeBias\(/, 'no opaque compare, no depth read');
  // No receiver plane: the exact read takes the receiver itself, past the page's test.
  assert.doesNotMatch(read, /vsmConsumerSlope\(/);
  for (const at of read.split('vsmTransmissionThrough(').slice(0, -1))
    assert.match(at, /if\(!vsmTransmissionPaned\(sm\)\)\{return;\}\n {1,2}shadowTransmission=$/);
  const uv = new Mat([
    0.01 / 1.6384,
    0,
    0,
    0,
    0,
    0,
    1,
    0,
    0,
    0.01 / 1.6384,
    0,
    0,
    0.5,
    0.5,
    0.5,
    1,
  ]);
  const normal = new Mat([0.2, 0, 0, 0, 0, 0, 1, 0, 0, 0.3, 0, 0, 0, 0, 0, 0]);
  const clip = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.001, 0, 0, 0, 0.5, 1]);
  // Three receivers in virtual page (5, 7), physical page (8, 8) of the pool, the one the panes
  // cover; the fourth in the next page, (9, 8), none covers.
  const receivers: V[] = [
    [-75.3, 0, -72.9],
    [-74.9, 0.002, -72.3],
    [-74.5, -0.001, -71.9],
    [-73.1, 0.002, -71.4],
  ];
  const normals: V[] = [
    [0, 1, 0],
    [0.3, 1, 0.2],
    [-0.4, 0.9, 0.1],
    [0.1, 1, -0.3],
  ];
  let cases = 0;
  for (const light of ['sun', 'spot', 'point'] as const)
    for (const pane of ['none', 'paned', 'behind', 'static'] as const)
      for (const mask of [0, 0.5, 1])
        for (const coarser of [false, true])
          for (const [k, P] of receivers.entries()) {
            const reads = { projection: 0, depth: 0 };
            const pd = {
              mapLevel: 5,
              levelsLeft: k === 2 && light === 'sun' && coarser ? 0 : 4,
              lightKind: light === 'spot' ? 2 : 1,
              finestMip: 0,
              shiftedToMapUv: uv,
              planesToMapUv: normal,
              lightViewToClip: clip,
              originShiftHigh: [0, 0, 0],
              originShiftLow: [0, 0, 0],
            };
            const world = new World();
            const calls: unknown[][] = [];
            const covered = pane !== 'none' && k < 3;
            const sampleAt = (h: { id: number }, uvs: V) => {
              reads.depth++;
              const s = pagedSample(uvs.slice(0, 2).map((u) => u * LEVEL));
              // At its page's first texel: the runner divides a \`u32\` as a double.
              s.poolTexel = s.poolTexel.map((t) => t - (t % PAGE));
              return { ...s, depth: 0.4, handle: coarser ? { ...h, id: h.id + 1 } : h };
            };
            const stubs = {
              isSun: () => light === 'sun',
              vsmMaskFactor: () => mask,
              vsmMaskPixel: [3, 4],
              textureDimensions: () => [pane === 'none' ? 1 : 1024, 1],
              vsmTransmissionMemory: 'memory',
              vsmTransmissionPaned: (sm: { valid: boolean }) => sm.valid && covered,
              vsmTransmissionThrough: (...a: unknown[]) => {
                calls.push(a);
                return covered && pane !== 'behind'
                  ? [0x99, 0x66, 0x33].map((c) => c / 255)
                  : [1, 1, 1];
              },
              vsmHandleFromIdDirectional: (id: number) => ({ id, isSinglePage: false }),
              vsmHandleFromId: (id: number) => ({ id, isSinglePage: false }),
              vsmProjectionOf: () => (reads.projection++, pd),
              vsmCubeFace: () => 2,
              vsmDistanceSqToOrigin: () => 1,
              vsmSampledLevel: () => 5.5,
              vsmSubtractHighLow: () => [0, 0, 0],
              vsmReadClipmap: sampleAt,
              vsmReadMap: (h: { id: number }, uvs: V) => ({
                ...sampleAt(h, uvs),
                handle: h,
                mipLevel: coarser ? 1 : 0,
              }),
              array: (...v: unknown[]) => v,
            };
            const runOf = (source: string) => {
              reads.projection = reads.depth = 0;
              calls.length = 0;
              // The runner has no typed array constructor: \`array(…)\`, the same two origins.
              const r = run<Resolve>(
                world,
                RESOLVE_READ,
                stubs,
                {},
                source.replace('array<vec2u,2>(', 'array('),
              );
              const value = r.shadowFactor(64 * MAP + 1, {}, P, normals[k], true);
              return {
                value,
                through: r.testTransmission(),
                reads: { ...reads },
                calls: JSON.stringify(calls),
              };
            };
            const before = runOf(RESOLVE_BEFORE),
              after = runOf(RESOLVE);
            const where = `${light} ${pane} mask ${mask} ${coarser} ${P}`;
            assert.equal(after.value, before.value, where);
            assert.deepEqual(after.through, before.through, where);
            if (covered && mask > 0 && pane !== 'behind' && before.reads.depth)
              assert.notDeepEqual(after.through, [1, 1, 1], `${where}: the pane is read`);
            // Where both read it, the same receiver; the resolve reads no receiver plane.
            if (after.calls !== '[]') assert.equal(after.calls, before.calls, where);
            assert.ok(after.reads.projection <= before.reads.projection, where);
            cases++;
          }
  assert.equal(cases, 3 * 4 * 3 * 2 * 4);
});
