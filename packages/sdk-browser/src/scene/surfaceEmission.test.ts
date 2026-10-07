// The resolve loads the emission-and-occlusion texel only under its flag bit, and reads back
// exactly what the half-float target holds. The shipped writer (`emissiveAoFlag`) and reader
// (`surfaceEmissiveAo`) run as JavaScript (`shaderRun`) on edge values — zero, negative zero, what
// the half float flushes to zero or rounds to one, its largest and past it, infinities, NaN —, the
// texel stored as the target converts it (`f16`), every component compared bit for bit.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { f16 } from '../effects/bloom.fixture.ts'
import { SHADE_SHADER } from '../visibility/shader/shadeWgsl.ts'
import { contractSurfaceBody } from '../lighting/deferred/surfaceWgsl.ts'
import {
  EMISSIVE_AO_FLAG_WGSL,
  SURFACE_EMISSIVE_AO_WGSL,
  surfaceEmitsOrOccludes,
} from './surfaceEmission.ts'
import {
  EMISSIVE_AO_SURFACE_FLAG,
  FOG_FREE_SURFACE_FLAG,
  SURFACE_MODEL_MASK,
} from './surfaceModel.ts'
import { SUBSURFACE_FLAG } from './subsurface.ts'
import { UNLIT_LIGHTING_SHADER } from '../gpu/core/shaderTexts.fixture.ts'

type Texel = number[]
const EDGES = [0, -0, 1e-9, 2 ** -24, 6e-5, 0.5, 1, 1 + 2 ** -12, 65504, 7e4, Infinity, -1, NaN]
const AOS = [1, 1 - 2 ** -13, 1 + 2 ** -12, 0.999, 0.5, 0, -0, NaN, Infinity]

/** The shipped writer, with the layer (`EMISSIVE_AO`) or without. */
const flagOf = (layer: boolean) =>
  shaderRun<{ emissiveAoFlag: (e: number[], a: number) => number }>(
    EMISSIVE_AO_FLAG_WGSL,
    ['emissiveAoFlag'],
    { EMISSIVE_AO: layer },
  ).emissiveAoFlag

/** The shipped pair, the target's texel given to the reader. */
function roundTrip(emissive: number[], ao: number, flag: number) {
  const texel: Texel = [...emissive, ao].map(f16)
  const scope = { emissiveAo: texel, textureLoad: (t: Texel) => t, EMISSIVE_AO: true }
  const { emissiveAoFlag } = shaderRun<{ emissiveAoFlag: (e: number[], a: number) => number }>(
    EMISSIVE_AO_FLAG_WGSL,
    ['emissiveAoFlag'],
    scope,
  )
  const { surfaceEmissiveAo } = shaderRun<{ surfaceEmissiveAo: (c: number[], f: number) => Texel }>(
    SURFACE_EMISSIVE_AO_WGSL,
    ['surfaceEmissiveAo'],
    scope,
  )
  const written = flag | emissiveAoFlag(emissive, ao)
  return { written, texel, read: surfaceEmissiveAo([3, 4], written) }
}

test('the texel read back is the stored one, bit for bit, set or skipped', () => {
  let skipped = 0,
    fetched = 0
  for (const flag of [1, 2, 4, 5, 2 | SUBSURFACE_FLAG | FOG_FREE_SURFACE_FLAG])
    for (const e of EDGES)
      for (const ao of AOS)
        for (const emissive of [
          [e, 0, 0],
          [0, e, 0],
          [0, 0, e],
          [e, e, e],
        ]) {
          const { written, texel, read } = roundTrip(emissive, ao, flag)
          const where = `emission ${emissive}, occlusion ${ao}, flag ${flag}`
          assert.equal(written & ~EMISSIVE_AO_SURFACE_FLAG, flag, `the other marks kept: ${where}`)
          assert.equal(written & SURFACE_MODEL_MASK, flag & SURFACE_MODEL_MASK)
          assert.ok(
            read.every((v, i) => Object.is(v, texel[i])),
            `${read} for ${texel}: ${where}`,
          )
          if (written & EMISSIVE_AO_SURFACE_FLAG) fetched++
          else skipped++
        }
  assert.ok(skipped > 0 && fetched > skipped, `${skipped} skipped, ${fetched} fetched`)
  assert.equal(roundTrip([0, 0, 0], 1, 2).written, 2, 'no emission, full occlusion: no fetch')
  assert.equal(roundTrip([-0, 0, 0], 1, 2).written, 2 | EMISSIVE_AO_SURFACE_FLAG, 'negative zero')
})

test('the material pass writes the bit; the resolve and the unlit view fetch through it alone', () => {
  const lit =
    /return SurfaceOut\(vec4f\(rgb,metal\),vec4f\(N,rough\),vec4f\(emissive,ao\),flag\|emissiveAoFlag\(emissive,ao\),request\);/
  assert.match(SHADE_SHADER, lit)
  assert.match(SHADE_SHADER, /fn emissiveAoFlag\(/)
  for (const reader of [contractSurfaceBody(false).text, UNLIT_LIGHTING_SHADER]) {
    assert.doesNotMatch(
      reader.replace(SURFACE_EMISSIVE_AO_WGSL.text, ''),
      /textureLoad\(emissiveAo/,
    )
    assert.match(reader, /surfaceEmissiveAo\(coord,(surfaceFlag|flag)\)/)
  }
})

// An image none of whose surfaces can mark a texel has no layer: its writer is compiled with
// `EMISSIVE_AO` false, its readers bind a 1×1 stand-in and never load it.
test('a surface the prudent census calls dark marks no texel; without the layer none is marked', () => {
  const marks = flagOf(true),
    none = flagOf(false)
  let dark = 0
  for (const e of EDGES)
    for (const intensity of [...AOS, -1, 1e39, -Infinity])
      for (const emissive of [
        [e, 0, 0],
        [0, 0, e],
        [e, e, e],
      ]) {
        // No map: the resolve writes the factor as emission and `1 + intensity × (1 - 1)`, in f32.
        const ao = Math.fround(1 + Math.fround(Math.fround(intensity) * 0)),
          written = marks(emissive.map(Math.fround), ao)
        const census = { emissive: emissive as [number, number, number], aoIntensity: intensity }
        if (!surfaceEmitsOrOccludes(census)) {
          dark++
          assert.equal(written, 0, `emission ${emissive}, intensity ${intensity}`)
        }
        assert.equal(none(emissive, ao), 0, 'without the layer, no mark')
      }
  assert.ok(dark > 0)
  const texture = {} as never
  assert.ok(surfaceEmitsOrOccludes({ emissive: [0, 0, 0], aoIntensity: 1, emissiveMap: texture }))
  assert.ok(surfaceEmitsOrOccludes({ emissive: [0, 0, 0], aoIntensity: 1, aoMap: texture }))
  assert.ok(surfaceEmitsOrOccludes({ emissive: [-0, 0, 0], aoIntensity: 1 }), 'negative zero')
  assert.ok(!surfaceEmitsOrOccludes({ emissive: [0, 0, 0], aoIntensity: 0.3 }))
  // Unmarked, a reader never loads the stand-in: it takes the constant the layer would hold.
  const { surfaceEmissiveAo } = shaderRun<{ surfaceEmissiveAo: (c: number[], f: number) => Texel }>(
    SURFACE_EMISSIVE_AO_WGSL,
    ['surfaceEmissiveAo'],
    {
      emissiveAo: {},
      textureLoad: () => assert.fail('the 1×1 stand-in is read'),
    },
  )
  assert.deepEqual(surfaceEmissiveAo([30, 20], 2 | FOG_FREE_SURFACE_FLAG), [0, 0, 0, 1])
})
