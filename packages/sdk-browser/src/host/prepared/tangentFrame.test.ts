// A normal map is shaded in the frame its pass builds. A page stores no tangent, so every
// engine pass rebuilds a page's frame from its triangle, and a surface the material table wrote for
// vertex tangents gives that frame the factor of its other variant: the one the prepared scene's
// own surface, written for a rebuilt frame, carries. Before, `source.gltf` and the prepared scene
// shaded one cache's normal maps with opposite second factors (22,102 px on WebGL2).
import test from 'node:test'
import assert from 'node:assert/strict'
import { preparedMaterials } from './materials.ts'
import { entry } from '../../world/api/materialApi.fixture.ts'
import { frameNormalScaleY } from '../../visibility/buffer.ts'
import * as G from '../graph/graph.fixture.ts'
import { visMaterial } from '../../visibility/shader/material.ts'

const plain = { vertexColors: false, flatShading: false }

test('both variants of a table surface shade a page with one factor, vertex tangents with their own', async () => {
  const surfaceOf = preparedMaterials(
    [entry({ normalScaleY: 0.8 }), entry({ derivativeTangents: true, normalScaleY: -0.8 })],
    async () => null,
  )
  const tangents = visMaterial(await surfaceOf(0, plain)),
    rebuilt = visMaterial(await surfaceOf(1, plain))
  assert.equal(frameNormalScaleY(tangents, false), -0.8, 'a page: the rebuilt frame’s factor')
  assert.equal(frameNormalScaleY(rebuilt, false), -0.8, 'the other variant shades it alike')
  assert.equal(frameNormalScaleY(tangents, true), 0.8, 'vertex tangents: the factor as written')
  assert.equal(frameNormalScaleY(rebuilt, true), 0.8, 'the table’s tangent variant of it')
})

test('a surface no table wrote keeps the factor it declares in either frame', () => {
  const foreign = visMaterial(G.standardSurface({ normalScale: new G.Vector2(1, 0.5) }))
  assert.equal(frameNormalScaleY(foreign, false), 0.5)
  assert.equal(frameNormalScaleY(foreign, true), 0.5)
})
