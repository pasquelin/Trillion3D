// A declared map its surface model never reads is refused by name, whatever the family: a tone ramp
// no model reads, and the normal map of every unlit family — the surface record drops both
// (`../page/surfaceRecord.ts`), so a declaration that names one would lose it from the image.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { SurfaceDeclaration } from '../page/surfaceDeclaration.ts'
import type { SurfaceFamily } from '../page/surface.ts'
import { litFamily, unreadMapRefusal } from './surfaceModel.ts'

const FAMILIES: SurfaceFamily[] = [
  'basic',
  'standard',
  'physical',
  'lambert',
  'phong',
  'toon',
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
