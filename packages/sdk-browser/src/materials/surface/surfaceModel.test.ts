// A declared map its surface model never reads is refused by name, whatever the family: a tone ramp
// no model reads, and the normal map of every unlit family — the surface record drops both
// (`../../geometry/pages/surfaceRecord.ts`), so a declaration that names one would lose it from the image.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { SurfaceDeclaration } from '../../geometry/pages/surfaceDeclaration.ts'
import type { SurfaceFamily } from '../../geometry/pages/surface.ts'
import { litFamily, unreadMapRefusal } from './surfaceModel.ts'
import { SURFACE_F0_WGSL, specularFlag, specularOfFlags } from './surfaceSpecular.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

const FAMILIES: SurfaceFamily[] = [
  'basic',
  'standard',
  'physical',
  'lambert',
  'phong',
  'normal',
  'matcap',
  'depth',
]
const map = {}
/** A declaration of `family` naming one map, `field`. */
const declared = (family: SurfaceFamily, field: string) =>
  ({ family, [field]: map }) as unknown as SurfaceDeclaration

test('a tone ramp is refused on every family: no model reads it', () => {
  for (const family of FAMILIES)
    assert.match(unreadMapRefusal(declared(family, 'gradientMap')) ?? '', /gradientMap/)
})

test('a normal map is refused on every unlit family, and read by every lit one', () => {
  for (const family of FAMILIES) {
    const refusal = unreadMapRefusal(declared(family, 'normalMap'))
    if (litFamily(family)) assert.equal(refusal, undefined, family)
    else assert.match(refusal ?? '', /normalMap/, family)
  }
})

test('a pixel’s specular rides the second byte of its surface flags, none given reads 0.5, and its reflectance is 0.08 of it', () => {
  type Vec3 = [number, number, number]
  const run = shaderRun<{
    specularFlag(specular: number): number
    specularOfFlags(flags: number): number
    surfaceF0(rgb: Vec3, metal: number): Vec3
  }>(
    wgslBlock('specularProbe', [specularFlag, specularOfFlags, SURFACE_F0_WGSL], ''),
    ['specularFlag', 'specularOfFlags', 'surfaceF0'],
    { u32: Math.trunc, surfaceSpecular: 0.5 },
  )
  // None given — the flags of a surface whose graph wires none — reads the default; a given one
  // reads back to a step of 1/254, 0 and 1 and the default 0.5 exactly.
  assert.equal(run.specularOfFlags(0b1110_0010), 0.5)
  for (const x of [0, 0.5, 1]) assert.equal(run.specularOfFlags(run.specularFlag(x) | 2), x)
  assert.ok(Math.abs(run.specularOfFlags(run.specularFlag(0.3)) - 0.3) <= 0.5 / 254)
  assert.equal(run.specularFlag(0.8) & 0xff, 0, 'the low byte is the flags’')
  assert.equal(run.specularFlag(2), run.specularFlag(1), 'held to [0, 1]')
  // The dielectric's reflectance at the default is the constant it replaces, to the bit; a metal's is its colour.
  assert.equal(Math.fround(Math.fround(0.08) * 0.5), Math.fround(0.04))
  assert.deepEqual(run.surfaceF0([0.9, 0.5, 0.1], 1), [0.9, 0.5, 0.1])
  assert.deepEqual(
    run.surfaceF0([0.9, 0.5, 0.1], 0).map((x) => +x.toFixed(6)),
    [0.04, 0.04, 0.04],
  )
})
