// The textures a warming actor asks are the engine's one census of a surface's textures, each in the atlas the engine reads it through.
import test from 'node:test'
import assert from 'node:assert/strict'
import { actorMaps } from './hlodWarm.ts'
import type { PageSurface } from '../../geometry/pages/surface.ts'
import type { Texture } from '../../../../sdk-core/src/texture/contract.ts'

const tex = () => ({}) as Texture

test('a surface’s maps are asked through the atlas the engine reads each through: the sheen colour a colour, the normal map data', () => {
  const map = tex(),
    normalMap = tex(),
    sheenColorMap = tex(),
    clearcoatMap = tex()
  const surface = {
    lit: true,
    sheen: 1,
    sheenRoughness: 0.5,
    map,
    normalMap,
    sheenColorMap,
    clearcoatMap,
  } as unknown as PageSurface
  const kinds = new Map(actorMaps(surface).map(({ texture, kind }) => [texture, kind]))
  assert.equal(kinds.get(map), 'color')
  assert.equal(kinds.get(normalMap), 'data')
  assert.equal(kinds.get(sheenColorMap), 'color', 'the sheen colour is a colour')
  assert.equal(kinds.get(clearcoatMap), 'data')
})

test('a texture a graph reads is asked too, as the census lists it', () => {
  const graphed = tex()
  const surface = { graph: { readTextures: () => [graphed] } } as unknown as PageSurface
  assert.deepEqual(actorMaps(surface), [{ texture: graphed, kind: 'color' }])
})
