// The program of a post-process material: the scene texture nodes, the refusals, the layout of the uniforms.
import test from 'node:test'
import assert from 'node:assert/strict'
import { material } from '../../../../sdk-core/src/world/material/index.ts'
import { Texture } from '../../../../sdk-core/src/world/texture/texture.ts'
import { compileGraph } from '../../materials/graph/compile.ts'
import { COLOR_SAMPLE } from '../../lighting/lightFunction/renderWgsl.ts'
import { isRefusal, takeGraphRefusals } from '../../materials/graph/kept.ts'
import { POST_GIVEN } from './postLayout.ts'
import { nameUndrawnBlendables, postProgramOf } from './postProgram.ts'
import { SCENE_TEXTURE_NUMBERS } from '../../materials/graph/nodesScene.ts'

test('a material with no graph is the one plain program', () => {
  const a = postProgramOf(material.postProcess())
  const b = postProgramOf(material.postProcess({ emissive: 0xff0000 }))
  assert.ok(!isRefusal(a) && !isRefusal(b))
  assert.equal(a, b)
  assert.equal(a.bytes, POST_GIVEN.words * 4)
  assert.ok(!a.wgsl.includes('MgValues'))
})

test('a scene texture node reads the image by its number, and the custom stencil as a value', () => {
  const g = material.graph('postProcess')
  const colour = g.sceneTexture('postProcessInput0', undefined, true)
  const stencil = g.channel(g.sceneTexture('customStencil'), 'r')
  g.output('emissive', g.multiply(g.channel(colour, 'rgb'), stencil))
  const program = postProgramOf(material.postProcess({ graph: g }))
  assert.ok(!isRefusal(program))
  assert.match(
    program.wgsl,
    new RegExp(`ppScene\\(${SCENE_TEXTURE_NUMBERS.postProcessInput0}u,ctx\\.uvs\\[0\\],true\\)`),
  )
  assert.match(program.wgsl, new RegExp(`ppScene\\(${SCENE_TEXTURE_NUMBERS.customStencil}u,`))
  assert.ok(!program.animated)
  assert.equal(program.bytes, POST_GIVEN.words * 4 + program.graph!.slots.bytes)
})

test('a graph that reads the time is animated', () => {
  const g = material.graph('postProcess')
  g.output('emissive', g.multiply(g.constant(1, 1, 1), g.sine(g.time(), 1)))
  const program = postProgramOf(material.postProcess({ graph: g }))
  assert.ok(!isRefusal(program) && program.animated)
})

test('a texture read, a world position and a scene texture of another domain are refused', () => {
  const textured = material.graph('postProcess')
  textured.output('emissive', textured.channel(textured.textureSample(new Texture()), 'rgb'))
  const refused = postProgramOf(material.postProcess({ graph: textured }))
  assert.ok(isRefusal(refused))
  assert.match(refused.error, /does not read a texture/)

  const placed = material.graph('postProcess')
  placed.output('emissive', placed.worldPosition())
  const world = postProgramOf(material.postProcess({ graph: placed }))
  assert.ok(isRefusal(world))
  assert.match(world.error, /worldPosition has no value in the postProcess domain/)

  const surface = material.graph('surface')
  surface.output('emissive', surface.channel(surface.sceneTexture('sceneColor'), 'rgb'))
  assert.throws(
    () => compileGraph(surface, { sample: COLOR_SAMPLE, derivatives: 'screen' }),
    /sceneTexture has no value in the surface domain/,
  )
})

test('the graph of a post-process material wires the colour and the opacity alone', () => {
  const g = material.graph('postProcess')
  assert.throws(
    () => g.output('baseColor', g.constant(1, 1, 1)),
    /postProcess domain does not read/,
  )
  assert.doesNotThrow(() => g.output('opacity', g.constant(1)))
})

test('a graph of another domain is refused by a post-process material', () => {
  assert.throws(() => material.postProcess({ graph: material.graph('surface') }), /cannot be worn/)
})

test('a material at a place the image does not offer is named once, by the place', () => {
  takeGraphRefusals()
  const ssr = material.postProcess({ blendableLocation: 'ssrInput' })
  const drawn = material.postProcess({ blendableLocation: 'sceneColorBeforeBloom' })
  const entries = [{ material: ssr }, { material: drawn }]
  nameUndrawnBlendables(entries)
  nameUndrawnBlendables(entries)
  assert.deepEqual(takeGraphRefusals(), ['BLENDABLE_LOCATION_NOT_DRAWN:ssrInput'])
})
