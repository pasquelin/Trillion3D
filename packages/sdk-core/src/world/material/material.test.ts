import test from 'node:test'
import assert from 'node:assert/strict'
import { Material } from './material.ts'
import { Color } from '../math/color.ts'
import { Texture } from '../texture/texture.ts'
import { side, blending } from '../constants/index.ts'
import { GRAPH_OUTPUTS, WATER_OUTPUTS, isWaterGraph, outputActive } from './graph/outputs.ts'

test('physical material records retain independent linear channels and supplied surface parameters', () => {
  const material = new Material(
    'meshStandard',
    {
      color: [0.2, 0.4, 0.6],
      emissive: [1, 0.5, 0.25],
      emissiveIntensity: 2,
      opacity: 0.3,
      metalness: 0.7,
      roughness: 0.8,
      side: 'double',
      alphaTest: 0.1,
      transparent: true,
    },
    { roughness: 0.2 },
  )
  assert.deepEqual(material.surface(), {
    baseColor: [0.2, 0.4, 0.6],
    emissive: [2, 1, 0.5],
    opacity: 0.3,
    metalness: 0.7,
    roughness: 0.8,
    side: 'double',
    alphaMode: 'blend',
    alphaCutoff: 0.1,
  })
  material.transparent = false
  assert.equal(material.surface().alphaMode, 'mask')
  material.alphaTest = 0
  assert.equal(material.surface().alphaMode, 'opaque')
  const copy = material.clone()
  assert.equal(copy.kind, 'meshStandard')
  assert.deepEqual(copy.surface(), material.surface())
  assert.notEqual(copy.color, material.color)
  copy.color.setRGB(0, 1, 0)
  assert.deepEqual(material.color.toArray(), [0.2, 0.4, 0.6])
})

test('sampled textures notify material wearers while bookkeeping and disposal stay quiet', () => {
  const texture = new Texture({ width: 2, height: 3 })
  const material = new Material('meshStandard', { map: texture })
  let writes = 0
  material._listeners.subscribe(() => writes++)
  texture.rotation = 0.3
  assert.equal(writes, 1)
  material.roughness = 0.4
  assert.equal(writes, 2)
  material.version = 100
  assert.equal(writes, 2)
  material.needsUpdate = true
  assert.equal(writes, 3)
  assert.equal(material.needsUpdate, false)
  material.dispose()
  texture.rotation = 0.5
  assert.equal(writes, 3)
})

test('cloned materials own revisions, callbacks and color channels independently', () => {
  const source = new Material('meshPhong', { specular: new Color([0.2, 0.3, 0.4]) })
  let sourceChanges = 0,
    copyChanges = 0
  source._listeners.subscribe(() => sourceChanges++)
  source.version = 123
  const copy = source.clone()
  assert.equal(copy.isMaterial, true)
  assert.equal(copy.kind, 'meshPhong')
  assert.equal(copy.version, 0)
  assert.notEqual(copy._listeners, source._listeners)
  copy._listeners.subscribe(() => copyChanges++)
  copy.opacity = 0.4
  assert.equal(copy.version, 1)
  assert.equal(source.version, 123)
  assert.equal(sourceChanges, 0)
  assert.equal(copyChanges, 1)
  ;(copy.specular as Color).setRGB(0.7, 0.8, 0.9)
  assert.deepEqual((source.specular as Color).toArray(), [0.2, 0.3, 0.4])
  source.dispose()
  copy.roughness = 0.5
  assert.equal(copyChanges, 3)
})

test('unobserved host metadata and optional texture listeners do not make assignment fail', () => {
  const material = new Material('meshBasic')
  const extension = { isTexture: true }
  material.map = extension
  assert.equal(material.map, extension)
  material.map = null
  assert.equal(material.map, null)
  const hostData = { _listeners: new Set<() => void>() }
  material.hostData = hostData
  assert.equal(hostData._listeners.size, 0)
  const metadata = Symbol('host-texture')
  const texture = new Texture(null)
  Reflect.set(material, metadata, texture)
  const before = material.version
  texture.rotation = 0.5
  assert.equal(material.version, before)
})

test('a texture a material no longer samples stops repainting it, unless another field still holds it', () => {
  const texture = new Texture({ width: 2, height: 2 })
  const material = new Material('meshStandard', { map: texture, emissiveMap: texture })
  let writes = 0
  material._listeners.subscribe(() => writes++)
  material.map = null
  writes = 0
  texture.rotation = 0.1
  assert.equal(writes, 1, 'still sampled as the emissive map')
  material.emissiveMap = new Texture(null)
  writes = 0
  texture.rotation = 0.2
  assert.equal(writes, 0, 'sampled by no field')
})

test('a new material is an opaque front face, blended normally, depth-tested and depth-writing', () => {
  const material = new Material('meshStandard')
  assert.equal(material.surface().alphaMode, 'opaque')
  assert.equal(material.surface().side, side.front)
  assert.equal(material.blending, blending.normal)
  assert.equal(material.depthTest && material.depthWrite, true)
  assert.equal(material.vertexColors, false, 'opt-in only')
})

test('a parameter given as undefined is not given', () => {
  const bare = new Material('meshStandard')
  assert.equal(new Material('meshStandard', { roughness: undefined }).roughness, bare.roughness)
})

test('a clone is heard by its own wearers alone', () => {
  const source = new Material('meshPhong', { specular: 0x112233 })
  let heard = 0
  source._listeners.subscribe(() => heard++)
  const copy = source.clone()
  copy.color.setRGB(0.1, 0.2, 0.3)
  ;(copy.specular as Color).setRGB(0.3, 0.2, 0.1)
  assert.equal(heard, 0)
})

test('the emission of a material’s graph may be negative only where the material allows it', () => {
  const plain = new Material('meshStandard')
  assert.equal(
    plain.allowNegativeEmissive,
    false,
    'held at zero, as every output is held to its range',
  )
  const allowing = new Material('meshStandard', { allowNegativeEmissive: true })
  assert.equal(allowing.allowNegativeEmissive, true)
  assert.equal(allowing.clone().allowNegativeEmissive, true, 'a clone keeps it')
  let heard = 0
  plain._listeners.subscribe(() => heard++)
  plain.allowNegativeEmissive = true
  assert.equal(heard, 1, 'a write is a change its wearers hear')
})

test('a material receives the clouds in its fog only where it asks', () => {
  const plain = new Material('meshStandard')
  assert.equal(plain.cloudFog, false, 'off by default')
  const asking = new Material('meshStandard', { cloudFog: true })
  assert.equal(asking.cloudFog, true)
  assert.equal(asking.clone().cloudFog, true, 'a clone keeps it')
  let heard = 0
  plain._listeners.subscribe(() => heard++)
  plain.cloudFog = true
  assert.equal(heard, 1, 'a write is a change its wearers hear')
})

test('a material has the lights cast contact shadows on it only where it asks', () => {
  const plain = new Material('meshStandard', { transparent: true })
  assert.equal(plain.contactShadows, false, 'off by default')
  const asking = new Material('meshStandard', { transparent: true, contactShadows: true })
  assert.equal(asking.contactShadows, true)
  assert.equal(asking.clone().contactShadows, true, 'a clone keeps it')
  let heard = 0
  plain._listeners.subscribe(() => heard++)
  plain.contactShadows = true
  assert.equal(heard, 1, 'a write is a change its wearers hear')
})

test('a material reads the shadows of the lights as the project does, until it asks for more', () => {
  const plain = new Material('meshStandard')
  assert.deepEqual(
    [
      plain.translucentLocalLightShadow,
      plain.translucentLocalLightShadowQuality,
      plain.translucentDirectionalLightShadowQuality,
    ],
    [false, 0, 0],
    'off by default',
  )
  const asking = new Material('meshStandard', {
    translucentLocalLightShadow: true,
    translucentLocalLightShadowQuality: 1,
    translucentDirectionalLightShadowQuality: 0.5,
  })
  assert.equal(asking.translucentLocalLightShadow, true)
  const clone = asking.clone()
  assert.deepEqual(
    [clone.translucentLocalLightShadowQuality, clone.translucentDirectionalLightShadowQuality],
    [1, 0.5],
    'a clone keeps them',
  )
  let heard = 0
  plain._listeners.subscribe(() => heard++)
  plain.translucentDirectionalLightShadowQuality = 1
  assert.equal(heard, 1, 'a write is a change its wearers hear')
})

test('a surface that is not lit reads its emission, opacity, mask and offset alone; a refraction is an output', () => {
  const read = (lit: boolean) =>
    (Object.keys(GRAPH_OUTPUTS) as (keyof typeof GRAPH_OUTPUTS)[]).filter((name) =>
      outputActive('surface', name, { blend: 'blend', lit }),
    )
  assert.deepEqual(read(false), ['emissive', 'opacity', 'worldPositionOffset', 'pixelDepthOffset'])
  assert.ok(read(true).includes('baseColor') && read(true).includes('refraction'))
  assert.deepEqual(GRAPH_OUTPUTS.refraction, { type: 'f1', fallback: [1] })
  assert.equal(
    outputActive('volume', 'baseColor', { blend: 'opaque', lit: false }),
    true,
    'the other domains read what they list',
  )
  assert.equal(outputActive('surface', 'opacityMask', { blend: 'mask', lit: false }), true)
  // The refraction is read only where the transparent pass draws the surface.
  assert.equal(
    outputActive('surface', 'refraction', { blend: 'opaque', translucent: false }),
    false,
  )
  assert.equal(outputActive('surface', 'refraction', { blend: 'opaque', translucent: true }), true)
})

test('a graph’s opacity mask has a clip value and a dither switch of the material, both unset by default', () => {
  const plain = new Material('meshStandard')
  assert.equal(plain.opacityMaskClipValue, undefined, 'unset: its alpha test, else 0.3333')
  assert.equal(plain.ditherOpacityMask, false)
  assert.equal(plain.normalCurvatureToRoughness, false)
  assert.equal(plain.twoSidedPasses, false, 'one pass for a double-sided blend unless it asks two')
  assert.equal(new Material('meshStandard', { twoSidedPasses: true }).twoSidedPasses, true)
  assert.equal(
    new Material('meshStandard', { normalCurvatureToRoughness: true }).normalCurvatureToRoughness,
    true,
  )
  const named = new Material('meshStandard', { opacityMaskClipValue: 0.6, ditherOpacityMask: true })
  assert.deepEqual([named.opacityMaskClipValue, named.ditherOpacityMask], [0.6, true])
  const copy = named.clone()
  assert.deepEqual([copy.opacityMaskClipValue, copy.ditherOpacityMask], [0.6, true])
  let heard = 0
  plain._listeners.subscribe(() => heard++)
  plain.opacityMaskClipValue = 0.2
  plain.ditherOpacityMask = true
  assert.equal(heard, 2, 'a write is a change its wearers hear')
})

test('a graph’s world position offset is a vector output of zero, read by every surface, its greatest offset and its always switch the material’s', () => {
  assert.deepEqual(GRAPH_OUTPUTS.worldPositionOffset, { type: 'f3', fallback: [0, 0, 0] })
  for (const blend of ['opaque', 'mask', 'blend'] as const)
    for (const lit of [true, false])
      assert.equal(outputActive('surface', 'worldPositionOffset', { blend, lit }), true)
  assert.equal(outputActive('volume', 'worldPositionOffset', { blend: 'opaque' }), false)
  const plain = new Material('meshStandard')
  assert.deepEqual(
    [plain.maxWorldPositionOffset, plain.alwaysEvaluateWorldPositionOffset],
    [0, false],
    'no greatest offset, not always',
  )
  const named = new Material('meshStandard', {
    maxWorldPositionOffset: 2,
    alwaysEvaluateWorldPositionOffset: true,
  })
  const copy = named.clone()
  assert.deepEqual([copy.maxWorldPositionOffset, copy.alwaysEvaluateWorldPositionOffset], [2, true])
  // The object’s switches (evaluate, distance, motion) are the node’s (`Object3D`), never the material’s.
  assert.ok(!('evaluateWorldPositionOffset' in plain))
  assert.ok(!('worldPositionOffsetDisableDistance' in plain))
  assert.ok(!('worldPositionOffsetWritesVelocity' in plain))
  let heard = 0
  plain._listeners.subscribe(() => heard++)
  plain.maxWorldPositionOffset = 1
  plain.alwaysEvaluateWorldPositionOffset = true
  assert.equal(heard, 2, 'a write is a change its wearers hear')
})

test('a graph that wires a water output is single-layer water, which reads the outputs of its volume, its opacity and its refraction', () => {
  assert.deepEqual(
    WATER_OUTPUTS.map((name) => GRAPH_OUTPUTS[name]),
    [
      { type: 'f3', fallback: [0, 0, 0] },
      { type: 'f3', fallback: [0, 0, 0] },
      { type: 'f1', fallback: [0] },
      { type: 'f3', fallback: [1, 1, 1] },
    ],
    'the reference node’s defaults: no scattering, no absorption, an isotropic phase, no colour scale',
  )
  assert.equal(isWaterGraph({ baseColor: 1 }), false)
  assert.equal(isWaterGraph({ baseColor: 1, phaseG: 1 }), true)
  assert.equal(isWaterGraph(undefined), false)
  for (const name of WATER_OUTPUTS) {
    assert.equal(outputActive('surface', name, { blend: 'opaque' }), false, 'not water: ignored')
    assert.equal(outputActive('surface', name, { blend: 'opaque', water: true }), true)
    assert.equal(outputActive('surface', name, { blend: 'opaque', water: true, lit: false }), false)
  }
  // The coverage of the base material over the water and the refraction are the water's, opaque as it is.
  assert.equal(outputActive('surface', 'opacity', { blend: 'opaque', water: true }), true)
  assert.equal(
    outputActive('surface', 'refraction', { blend: 'opaque', translucent: false, water: true }),
    true,
  )
})
