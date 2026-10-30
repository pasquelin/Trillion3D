// The traced shadows' sizes (`params.ts`): the fit of every buffer, the one list of sizes, and what the shape names of them.

import test from 'node:test'
import assert from 'node:assert/strict'
import { LIGHTING_FLAG, LIGHTING_PARAMS, tracedShadowWords } from './layout.ts'
import { shapeKey, shapeOf, tracedRaysFit, writeLightingParams } from './params.ts'
import { lightingImage, lightingSettings as settings } from './params.fixture.ts'
import { WORD_LIGHT_FORMAT } from '../../../gpu/core/lightAtlasFormat.ts'

test('the traced rays fit only where every buffer — the shadows’ masks and traces, the scene trace’s geometry and table — fits a binding and a buffer of the device', () => {
  const shape = shapeOf(settings, 4096, false, WORD_LIGHT_FORMAT)
  const lightTiles = shape.directTiles * shape.maxLights
  const roomy = { maxStorageBufferBindingSize: 2 ** 30, maxBufferSize: 2 ** 30 }
  const scene = { geometry: 3000, table: 500 }
  assert.equal(tracedRaysFit(roomy, lightTiles, scene, 'grey'), true)
  // The traces are the largest buffer: one word for each texel of each light tile.
  const words = tracedShadowWords(lightTiles, 'grey')
  const bytes = words.traces * 4
  assert.ok(bytes > words.masks * 4)
  const binding = { ...roomy, maxStorageBufferBindingSize: bytes }
  assert.equal(tracedRaysFit(binding, lightTiles, scene, 'grey'), true)
  assert.equal(
    tracedRaysFit(
      { ...binding, maxStorageBufferBindingSize: bytes - 4 },
      lightTiles,
      scene,
      'grey',
    ),
    false,
  )
  assert.equal(
    tracedRaysFit({ ...roomy, maxBufferSize: bytes - 4 }, lightTiles, scene, 'grey'),
    false,
  )
  // Each of the scene trace's buffers decides alone, to the word.
  const full = bytes / 4
  assert.equal(tracedRaysFit(binding, lightTiles, { geometry: full, table: full }, 'grey'), true)
  for (const name of ['geometry', 'table'] as const)
    assert.equal(
      tracedRaysFit(binding, lightTiles, { ...scene, [name]: full + 1 }, 'grey'),
      false,
      name,
    )
})

test('the traced shadows’ sizes are one list: the buffers are made at it and the fit is checked against it', () => {
  // 16 words of masks a light tile, a trace for each of the 64 texels of each.
  assert.deepEqual(tracedShadowWords(100, 'grey'), {
    masks: 1600,
    traces: 1 + 64 * 100,
  })
  const sceneSmall = { geometry: 1, table: 1 }
  const most = Math.max(...Object.values(tracedShadowWords(100, 'grey'))) * 4
  const limits = { maxStorageBufferBindingSize: most, maxBufferSize: most }
  assert.equal(tracedRaysFit(limits, 100, sceneSmall, 'grey'), true)
  assert.equal(
    tracedRaysFit({ ...limits, maxBufferSize: most - 4 }, 100, sceneSmall, 'grey'),
    false,
  )
  // The radiosity traced alone: the scene trace's buffers decide, no shadow buffer being made.
  assert.equal(tracedRaysFit({ ...limits, maxBufferSize: 4 }, 0, sceneSmall, 'grey'), true)
  assert.equal(
    tracedRaysFit({ ...limits, maxBufferSize: 4 }, 0, { ...sceneSmall, geometry: 2 }, 'grey'),
    false,
  )
})

test('the shape names nothing of the traced shadows: turning them on or off keeps the lighting’s resources', () => {
  const shape = shapeOf(settings, 4096, false, WORD_LIGHT_FORMAT)
  assert.ok(!('traced' in shape))
  const direct = { ...settings, surfaceCacheDirectLighting: !settings.surfaceCacheDirectLighting }
  const traced = {
    ...settings,
    surfaceCacheDirectLightingHardwareRayTracing:
      !settings.surfaceCacheDirectLightingHardwareRayTracing,
  }
  assert.equal(shapeKey(shapeOf(direct, 4096, false, WORD_LIGHT_FORMAT)), shapeKey(shape))
  assert.equal(shapeKey(shapeOf(traced, 4096, false, WORD_LIGHT_FORMAT)), shapeKey(shape))
})

test('the coloured atlas doubles the masks, two bytes a texel: 32 words a light tile', () => {
  assert.deepEqual(tracedShadowWords(100, 'colour'), {
    masks: 3200,
    traces: 1 + 64 * 100,
  })
  assert.equal(tracedShadowWords(100, 'grey').masks, 1600)
  // The masks count in the fit of the buffers.
  const sceneSmall = { geometry: 1, table: 1 }
  const most = Math.max(...Object.values(tracedShadowWords(100, 'colour'))) * 4
  const limits = { maxStorageBufferBindingSize: most, maxBufferSize: most }
  assert.equal(tracedRaysFit(limits, 100, sceneSmall, 'colour'), true)
  assert.equal(
    tracedRaysFit({ ...limits, maxBufferSize: 4 * 3000 }, 100, sceneSmall, 'colour'),
    false,
  )
})

test('the adaptive tracing, which lets a trace answer a quad of texels, is the scene’s triangles’: the shadows traced through the distance fields never have it', () => {
  const flagOf = (fieldShadows: boolean) => {
    const words = new Uint32Array(LIGHTING_PARAMS.words)
    writeLightingParams(
      words,
      shapeOf(settings, 1024, false, WORD_LIGHT_FORMAT),
      { ...settings, surfaceCacheDirectLightingHardwareRayTracingAdaptiveShadowTracing: true },
      lightingImage({ fieldShadows }),
    )
    return words[LIGHTING_PARAMS.at.flags] & LIGHTING_FLAG.adaptiveShadowTracing
  }
  assert.notEqual(flagOf(false), 0)
  assert.equal(flagOf(true), 0)
})
