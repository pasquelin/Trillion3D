// The opaque resolve reads the transmission alone, at the located sample (`vsmLocate`): the opaque
// shadow is the mask's, the translucent casters' colour the page table's, read only where a pane
// covers the sample's page. The blended surfaces and the water read it through the same function
// after their trace (`directShadowWgsl`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../texture/shaderRun.fixture.ts'
import { Mat } from '../../texture/shaderRunMatrix.fixture.ts'
import { functionText } from '../../bounce/wgslBody.fixture.ts'
import { directShadowWgsl } from './shadowWgsl.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'

type V = number[]
const PAGE = 128,
  LEVEL = 16384,
  /** The first full map's id: the handle every case reads. */
  MAP = 8192

/** A sample at virtual texel position `p` of map `MAP`, its physical page its virtual one shifted
 *  by (3, 1). */
function pagedSample(p: V) {
  const at = p.map(Math.floor)
  return {
    depth: 0,
    mipLevel: 0,
    handle: { id: MAP, isSinglePage: false },
    valid: true,
    mapTexelXY: at,
    mapTexelPos: p,
    poolTexel: at.map((t, a) => t + [3, 1][a] * PAGE),
  }
}

/** The module run in JavaScript, with the stubs `extra`. */
const run = <T>(names: string[], extra: object, source: string) =>
  shaderRun<T>(source, names, {
    VSM_NORMAL_OFFSET_FLOOR: 0.0002,
    LIGHT_KIND_SPOT: 2,
    vsm: { poolPages: 2048, poolPagesXY: [128, 16], normalBias: 0.0005 },
    shadowTransmission: [1, 1, 1],
    shadowCamera: [0, 0, 0],
    shadowAngularPixel: 0.001,
    shadowViewWidth: 1000,
    VsmLocated: (sm: object, clipmap: boolean, fromMap: V) => ({ sm, clipmap, fromMap }),
    vsmEmptyRead: () => ({ valid: false }),
    vsmHandleOffset: (h: { id: number }, offset: number) => ({ ...h, id: h.id + offset }),
    ...extra,
  })

/** The opaque resolve's read (`shadowFactor` over the mask). */
const RESOLVE = `${wgslModule(directShadowWgsl(25, { resolveTransmission: 14 }))}
fn testTransmission()->vec3f{return shadowTransmission;}`
const RESOLVE_READ = [
  'shadowFactor',
  'vsmTranslucentCasters',
  'vsmTransmissionRead',
  'vsmLocate',
  'vsmReceiverFromEye',
  'vsmNormalOffsetLength',
  'testTransmission',
]
type Resolve = { shadowFactor: (...a: unknown[]) => number; testTransmission: () => V }

test('the resolve reads the mask, and the transmission alone where a pane covers its sample', () => {
  const read = functionText(RESOLVE, 'vsmTransmissionRead')
  assert.doesNotMatch(read, /\.depth/, 'no opaque compare')
  assert.match(read, /if\(!vsmTransmissionPaned\(at\.sm\)\)\{return;\}\n shadowTransmission=/)
  const uv = new Mat([0.01 / 1.6384, 0, 0, 0, 0, 0, 1, 0, 0, 0.01 / 1.6384, 0, 0, 0.5, 0.5, 0.5, 1])
  const normal = new Mat([0.2, 0, 0, 0, 0, 0, 1, 0, 0, 0.3, 0, 0, 0, 0, 0, 0])
  const clip = new Mat([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0.001, 0, 0, 0, 0.5, 1])
  // Three receivers in virtual page (5, 7), physical page (8, 8) of the pool, the one the panes
  // cover; the fourth in the next page, (9, 8), none covers.
  const receivers: V[] = [
    [-75.3, 0, -72.9],
    [-74.9, 0.002, -72.3],
    [-74.5, -0.001, -71.9],
    [-73.1, 0.002, -71.4],
  ]
  const normals: V[] = [
    [0, 1, 0],
    [0.3, 1, 0.2],
    [-0.4, 0.9, 0.1],
    [0.1, 1, -0.3],
  ]
  let cases = 0
  for (const light of ['sun', 'spot', 'point'] as const)
    for (const pane of ['none', 'paned', 'behind', 'static'] as const)
      for (const mask of [0, 0.5, 1])
        for (const coarser of [false, true])
          for (const [k, P] of receivers.entries()) {
            const reads = { projection: 0 }
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
            }
            const calls: unknown[][] = []
            const covered = pane !== 'none' && k < 3
            const sampleAt = (h: { id: number }, uvs: V) => {
              const s = pagedSample(uvs.slice(0, 2).map((u) => u * LEVEL))
              // At its page's first texel: the runner divides a \`u32\` as a double.
              s.poolTexel = s.poolTexel.map((t) => t - (t % PAGE))
              return { ...s, depth: 0.4, handle: coarser ? { ...h, id: h.id + 1 } : h }
            }
            const stubs = {
              isSun: () => light === 'sun',
              vsmMaskFactor: () => mask,
              vsmMaskPixel: [3, 4],
              textureDimensions: () => [pane === 'none' ? 1 : 1024, 1],
              vsmTransmissionMemory: 'memory',
              vsmTransmissionPaned: (sm: { valid: boolean }) => sm.valid && covered,
              vsmTransmissionThrough: (...a: unknown[]) => {
                calls.push(a)
                return covered && pane !== 'behind'
                  ? [0x99, 0x66, 0x33].map((c) => c / 255)
                  : [1, 1, 1]
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
            }
            // The runner has no typed array constructor: \`array(…)\`, the same two origins.
            const source = RESOLVE.replace('array<vec2u,2>(', 'array(')
            const r = run<Resolve>(RESOLVE_READ, stubs, source)
            const value = r.shadowFactor(64 * MAP + 1, {}, P, normals[k], true)
            const where = `${light} ${pane} mask ${mask} ${coarser} ${P}`
            // A sample where a level holds the point: every light's but a sun's past its levels.
            const located = !(k === 2 && light === 'sun' && coarser)
            const lit = mask > 0 && pane !== 'none'
            assert.equal(value, mask, where)
            assert.equal(reads.projection > 0, lit, `${where}: a lookup only for a lit pane`)
            assert.equal(calls.length, lit && located && covered ? 1 : 0, where)
            if (calls.length) assert.equal(calls[0][4], light === 'sun', `${where}: the clipmap`)
            const through = calls.length === 1 && pane !== 'behind'
            const colour = [0x99, 0x66, 0x33].map((c) => c / 255)
            assert.deepEqual(r.testTransmission(), through ? colour : [1, 1, 1], where)
            cases++
          }
  assert.equal(cases, 3 * 4 * 3 * 2 * 4)
})
