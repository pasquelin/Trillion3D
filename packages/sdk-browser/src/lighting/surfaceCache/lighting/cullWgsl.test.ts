// The cull of the lights of a tile: the box it bounds a tile by spans the depth range the pass before wrote, or the card's whole depth.
import test from 'node:test'
import assert from 'node:assert/strict'
import { wgslSource } from '../../../../../math/src/wgsl/source.fixture.ts'
import { lcgRandom } from '../../../../../math/src/sequence/random.ts'
import { SRGB_LUMINANCE } from '../../../../../math/src/color/color.ts'
import type { SceneLight } from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { assertProgramAssembles } from '../../../gpu/core/wgslNames.fixture.ts'
import { LIGHTS, recordOf, type LightRecord } from '../../direct/lightReach.fixture.ts'
import { wgslBufferBindings } from '../../../gpu/core/wgslBindings.fixture.ts'
import { CULL_BINDINGS, CULL_ENTRY, cullWgsl } from './cullWgsl.ts'
import { add, scale } from '../../../../../math/src/vector/vectorTuple.fixture.ts'
import { atmosphere, cull, tileBox, type V } from './cullWgsl.fixture.ts'

test("the tile's box spans the depth range of its word where the cull to the tile's depth range is on, the card's whole depth, 0 to 1, where it is off", () => {
  const text = wgslSource(cullWgsl(4))
  assert.match(
    text,
    /var depths=vec2f\(0\.0,1\.0\);\s*if\(lgFlag\(FLAG_CULL_TO_TILE_DEPTH_RANGE\)\)\{depths=unpack2x16float\(depthRanges\[tile\]\);\}/,
  )
  assert.match(text, /tileBox\(page,coord,depths\)/)
})

test('the cull computes no depth range of its own: it reads the word of the pass before', () => {
  const text = wgslSource(cullWgsl(4))
  assert.doesNotMatch(text, /atomicM(in|ax)/)
  assert.doesNotMatch(text, /texDepth/)
  assert.match(text, /@binding\(7\) var<storage,read> depthRanges:array<u32>;/)
})

test('the cull gives the tile a light tile for each light it keeps, in the slot of the light’s kind, and records where its lights begin and how many', () => {
  const text = wgslSource(cullWgsl(4))
  assert.match(text, /lightsAt=atomicAdd\(&lightTileCounts\[LT_ALLOCATOR\],kept\);/)
  assert.match(text, /tilesAt=atomicAdd\(&lightTileCounts\[LT_CARD_TILE_ALLOCATOR\],kept\);/)
  assert.match(text, /atomicAdd\(&lightTileCounts\[givenAt\(lightTileSlot\(kind,rank\)\)\],1u\);/)
  assert.match(text, /cardTileOffsets\[tile\*CARD_TILE_OFFSET_WORDS\]=tilesAt;/)
  assert.match(text, /cardTileOffsets\[tile\*CARD_TILE_OFFSET_WORDS\+1u\]=kept;/)
  // The allocators are taken by the leading thread alone, and only where the tile keeps a light.
  assert.match(text, /if\(lane==0u\)\{\s*var lightsAt=0u;\s*var tilesAt=0u;\s*if\(kept>0u\)\{/)
})

test('the cull binds eight storage buffers, the guaranteed limit: the tables, the context, the counters, the tiles’ offsets, the light tiles, the lights, the depth ranges and the bits of the standalone lights', () => {
  const B = CULL_BINDINGS
  assert.deepEqual(wgslBufferBindings(cullWgsl(4)), [
    { binding: 0, type: 'uniform' },
    { binding: B.tables, type: 'read-only-storage' },
    { binding: B.context, type: 'read-only-storage' },
    { binding: B.counts, type: 'storage' },
    { binding: B.cardTileOffsets, type: 'storage' },
    { binding: B.culled, type: 'storage' },
    { binding: B.lights, type: 'read-only-storage' },
    { binding: B.depthRanges, type: 'read-only-storage' },
    { binding: B.standalone, type: 'read-only-storage' },
  ])
})

const sub = (a: V, b: V) => a.map((x, i) => x - b[i])
const dot = (a: readonly number[], b: readonly number[]) =>
  a.reduce((sum, x, i) => sum + x * b[i], 0)
const cross = (a: V, b: V) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
const unit = (a: V) => scale(a, 1 / Math.hypot(...a))
const saturate = (x: number) => Math.min(Math.max(x, 0), 1)
const square = (x: number) => x * x

/** The test twin of the reference's weight of a light for a tile, written from its steps on the light's record: the luminance of the
 *  light's colour times its local attenuation (the inverse-square falloff windowed by the range, the spot's cone, the radial mask), times the
 *  irradiance a point with no normal takes from the rectangle (its Lambert integral over the edges) or from the capsule (the line integral,
 *  no bias). */
function referenceWeight(light: SceneLight, r: LightRecord, P: V, sunTransmittance?: V) {
  const [intensity, indirectScale] = [r.colorIntensity[3], r.contactGi[3]]
  let colour = r.colorIntensity.slice(0, 3).map((c) => c * intensity * indirectScale)
  if (light.kind === 'directional') {
    // The colour times the transmittance toward the sun.
    if (sunTransmittance) colour = colour.map((c, i) => c * sunTransmittance[i])
    return dot(colour, SRGB_LUMINANCE)
  }
  const toLight = sub(r.positionRange.slice(0, 3), P)
  const distanceSquared = dot(toLight, toLight)
  const L = scale(toLight, 1 / Math.sqrt(distanceSquared))
  const invRadius = 1 / r.positionRange[3]
  const emit = r.directionCone.slice(0, 3)
  // A rectangle's shape holds its half axis, not an exponent: it falls off as the inverse square (its FalloffExponent is 0).
  const exponent = light.kind === 'rect' ? 0 : r.shape[1]
  let mask =
    exponent === 0
      ? square(saturate(1 - square(distanceSquared * square(invRadius))))
      : Math.pow(1 - saturate(distanceSquared * square(invRadius)), exponent)
  if (light.kind === 'spot') {
    const [cosOuter, cosInner] = [r.directionCone[3], r.params[3]]
    mask *= square(saturate((dot(L, scale(emit, -1)) - cosOuter) / (cosInner - cosOuter)))
  }
  let integral: number
  if (light.kind === 'rect') {
    // The rectangle's normal points away from a point behind it.
    if (dot(emit, L) > 0) mask = 0
    const axis0 = unit(r.shape.slice(0, 3)),
      axis2 = scale(emit, -1)
    const axis1 = cross(axis2, axis0)
    const extent = [Math.hypot(...r.shape.slice(0, 3)), r.shape[3]]
    if (extent[0] === 0 || extent[1] === 0) return 0
    const [x, y, z0] = [dot(axis0, toLight), dot(axis1, toLight), dot(axis2, toLight)]
    const corner = (cx: number, cy: number) => scale([cx, cy, z0], 1 / Math.hypot(cx, cy, z0))
    const [L0, L1, L2, L3] = [
      corner(x - extent[0], y - extent[1]),
      corner(x + extent[0], y - extent[1]),
      corner(x + extent[0], y + extent[1]),
      corner(x - extent[0], y + extent[1]),
    ]
    const edge = (a: V, b: V) => {
      const c = dot(a, b)
      return (1.5708 - 0.175 * c) / Math.sqrt(Math.max(c + 1, 1.0e-4))
    }
    const [w01, w12, w23, w30] = [edge(L0, L1), edge(L1, L2), edge(L2, L3), edge(L3, L0)]
    const vector = add(
      cross(L1, add(scale(L0, -w01), scale(L2, w12))),
      cross(L3, add(scale(L0, w30), scale(L2, -w23))),
    )
    const world = add(
      add(scale(axis0, vector[0]), scale(axis1, vector[1])),
      scale(axis2, vector[2]),
    )
    integral = 0.5 * Math.hypot(...world)
  } else {
    const half = scale(r.capsule.slice(0, 3), r.traits[1]) // unit axis times half length
    let falloff: number
    if (half.some((c) => c !== 0)) {
      const [line0, line1] = [sub(toLight, half), add(toLight, half)]
      const [inv0, inv1] = [1 / Math.hypot(...line0), 1 / Math.hypot(...line1)]
      const cosSubtended = dot(line0, line1) * inv0 * inv1
      falloff = (inv0 * inv1) / (cosSubtended * 0.5 + 0.5)
    } else falloff = 1 / distanceSquared
    integral = exponent === 0 ? falloff : 1
  }
  return dot(colour, SRGB_LUMINANCE) * mask * integral
}

const EXTRA: SceneLight[] = [
  { ...LIGHTS[0], id: 'tube', emitterLength: 1.4, emitterAxis: [0.6, 0.8, 0] },
  { ...LIGHTS[0], id: 'sphere', emitterRadius: 0.3 },
  { ...LIGHTS[0], id: 'radial', inverseSquared: false, radialExponent: 3 },
  { ...LIGHTS[1], id: 'spotRadial', inverseSquared: false, radialExponent: 5 },
  {
    ...LIGHTS[0],
    id: 'scaled',
    indirectLightingIntensity: 0.25,
    color: [0.9, 0.5, 0.2],
    intensity: 3,
  },
]

test('the cull program assembles with the air tint and the shadow mask test it weighs and keys lights by', () => {
  assertProgramAssembles(wgslSource(cullWgsl(4)), CULL_ENTRY)
})

test('a light weighs as the reference weighs it: its colour times its indirect factor times what reaches the tile centre, lamps, tubes, spots and rectangles, near and far, on both sides of a rectangle', () => {
  const random = lcgRandom(2701)
  const { tileLightWeight } = cull(atmosphere(-1, false))
  let compared = 0
  for (const [rank, light] of [...LIGHTS, ...EXTRA].entries()) {
    const r = recordOf(light)
    for (let i = 0; i < 8; i++) {
      const dir = unit([random() - 0.5, random() - 0.5, random() - 0.5])
      const P = add(
        r.positionRange.slice(0, 3),
        scale(dir, r.positionRange[3] * (0.05 + 1.05 * random())),
      )
      const expected = referenceWeight(light, r, P)
      const got = tileLightWeight(rank, r, tileBox(P, 1e-3))
      if (got < 0) {
        // Not a candidate: past its range, outside its cone, behind its face; the reference's weight is nothing there.
        assert.ok(
          expected < 1e-6 * (1 + dot(r.colorIntensity.slice(0, 3), SRGB_LUMINANCE)),
          `${light.id} ${expected}`,
        )
        continue
      }
      compared++
      assert.ok(
        Math.abs(got - expected) <= 1e-9 * Math.max(1, Math.abs(expected)),
        `${light.id}: ${got} against ${expected}`,
      )
    }
  }
  assert.ok(compared > 200, `${compared} lights compared`)
})

test('a rectangle behind its face is a candidate of weight 0 where its tile box reaches in front, and a rectangle of no width or no height weighs 0', () => {
  const rect = LIGHTS.findIndex((light) => light.kind === 'rect')
  const r = recordOf(LIGHTS[rect])
  const { tileLightWeight } = cull(atmosphere(-1, false))
  const emit = r.directionCone.slice(0, 3)
  const behind = sub(r.positionRange.slice(0, 3), scale(emit, 0.1))
  const front = add(r.positionRange.slice(0, 3), scale(emit, 0.5))
  assert.equal(tileLightWeight(rect, r, tileBox(behind, 100)), 0)
  const lit = tileLightWeight(rect, r, tileBox(front, 1e-3))
  assert.ok(lit > 0)
  assert.ok(Math.abs(lit - referenceWeight(LIGHTS[rect], r, front)) <= 1e-9 * lit)
  assert.equal(
    tileLightWeight(rect, { ...r, shape: [...r.shape.slice(0, 3), 0] }, tileBox(front, 1e-3)),
    0,
  )
  assert.equal(
    tileLightWeight(rect, { ...r, shape: [0, 0, 0, r.shape[3]] }, tileBox(front, 1e-3)),
    0,
  )
})

test('a sun that asks for its transmittance per point weighs with the tint toward it at the ground, any other light untinted', () => {
  const sun = LIGHTS.findIndex((light) => light.kind === 'directional')
  const r = recordOf(LIGHTS[sun])
  const box = tileBox([1, 2, 3], 1)
  const tinted = cull(atmosphere(sun, true)).tileLightWeight(sun, r, box)
  assert.ok(Math.abs(tinted - referenceWeight(LIGHTS[sun], r, [1, 2, 3], [0.9, 0.6, 0.3])) <= 1e-12)
  const bare = cull(atmosphere(sun, false)).tileLightWeight(sun, r, box)
  assert.ok(Math.abs(bare - referenceWeight(LIGHTS[sun], r, [1, 2, 3])) <= 1e-12)
  assert.ok(tinted < bare)
  const other = cull(atmosphere(sun, true)).tileLightWeight(sun + 1, r, box)
  assert.ok(Math.abs(other - bare) <= 1e-12, 'a rank that is not the air light takes no tint')
})

test('the key packs the weight, whether the light needs a shadow mask, its type and its rank as the reference packs a light sample', () => {
  const bits = (weight: number) => new Uint32Array(new Float32Array([weight]).buffer)[0]
  const packed = (weight: number, type: number, mask: boolean, rank: number) =>
    (((bits(weight) << 1) & 0xfffe0000) |
      (mask ? 0x10000 : 0) |
      ((type << 14) & 0xc000) |
      (rank & 0x3fff)) >>>
    0
  const kinds = { directional: 0, point: 1, spot: 2, rect: 3 } as const
  const { lightKey } = cull(atmosphere(-1, false))
  for (const [rank, light] of LIGHTS.entries()) {
    for (const casts of [true, false]) {
      const r = recordOf({ ...light, castsShadow: casts })
      assert.equal(
        lightKey(0.37, rank, r, false),
        packed(0.37, kinds[light.kind], casts, rank),
        `${light.id} ${casts}`,
      )
    }
  }
  const sun = LIGHTS.findIndex((light) => light.kind === 'directional')
  const quiet = recordOf({ ...LIGHTS[sun], castsShadow: false })
  assert.equal(lightKey(1.5, sun, quiet, false), packed(1.5, 0, false, sun))
  assert.equal(
    cull(atmosphere(sun, true)).lightKey(1.5, sun, quiet, false),
    packed(1.5, 0, true, sun),
    'the air light is masked by the clouds',
  )
})

test('a light that wears a light function the atlas holds no slot of needs a shadow mask, as one that casts a shadow does, and is marked in the light tile it gets', () => {
  const { lightKey } = cull(atmosphere(-1, false))
  const quiet = recordOf({ ...LIGHTS[0], castsShadow: false })
  const casting = recordOf({ ...LIGHTS[0], castsShadow: true })
  // The mask bit is the one a shadow caster has; the type of a standalone light is a sun's, 0, whatever its kind (a point light here).
  assert.equal(lightKey(0.5, 0, quiet, true), (lightKey(0.5, 0, casting, false) & ~0xc000) >>> 0)
  assert.equal(
    lightKey(0.5, 0, quiet, false) & 0x10000,
    0,
    'a light that needs none keeps the bit clear',
  )
  const text = wgslSource(cullWgsl(4))
  assert.match(
    text,
    /culledTiles\[at\+1u\]=culledTileWord\(rank\|select\(0u,TILE_LIGHT_STANDALONE,standaloneLight\(rank\)\),k,kind\);/,
  )
  assert.match(text, /@binding\(8\) var<storage,read> standaloneLights:array<u32>;/)
})

test('a light weighs by its strength, its intensity under the exposure its blend asks for', () => {
  assert.match(
    wgslSource(cullWgsl(4)),
    /light\.colorIntensity\.rgb\*lightStrength\(light\)\*light\.contactGi\.w/,
  )
})

test('a standalone light is keyed as a sun is, type 0, whatever its kind; the rank and the weight are untouched', () => {
  const { lightKey } = cull(atmosphere(-1, false))
  for (const [rank, light] of LIGHTS.entries()) {
    const r = recordOf(light)
    const own = lightKey(0.37, rank, r, false)
    const standalone = lightKey(0.37, rank, r, true)
    assert.equal((standalone >>> 14) & 3, 0, `${light.id} keyed as a sun`)
    assert.equal(standalone, (own & ~0xc000) >>> 0, `${light.id}: only the type differs`)
  }
})

test('a light whose factor on the indirect lighting is not above 0 is no candidate of the cards, any kind and any tile; a light that has some weighs as before', () => {
  const { tileLightWeight } = cull(atmosphere(-1, false))
  for (const [rank, light] of LIGHTS.entries()) {
    const r = recordOf(light)
    const P = add(
      r.positionRange.slice(0, 3),
      scale(unit([0.3, 0.5, 0.8]), 0.2 * r.positionRange[3]),
    )
    const box = tileBox(P, 1e-3)
    const none = recordOf({ ...light, indirectLightingIntensity: 0 })
    assert.equal(tileLightWeight(rank, none, box), -1, `${light.id} with factor 0`)
    const some = recordOf({ ...light, indirectLightingIntensity: 1e-3 })
    assert.equal(
      tileLightWeight(rank, some, box) < 0,
      tileLightWeight(rank, r, box) < 0,
      `${light.id}: a small factor leaves it a candidate where it was one`,
    )
  }
})
