// What a ray brings back, fogged along its length and lit by the sky light that leaks onto what it hits (`rayLightWgsl.ts`), run as
// JavaScript (`shaderRun`). Split from `wgsl.test.ts`.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../../math/src/wgsl/assemble.ts'
import type { Vec3 } from '../../../../math/src/vector/vectorTuple.ts'
import { reflectionRayLightWgsl } from './rayLightWgsl.ts'
import { FOG_VIEW_SLOT } from '../fog/viewSlots.ts'
import { FOG_SLOT } from '../../../../sdk-core/src/scene/core/fog.ts'
import { fogLights } from './sceneTrace.fixture.ts'

test('what a ray brings back is fogged along its length where the settings and the scene say so', () => {
  const fogged = (fog: object | undefined, on = true) =>
    shaderRun<{ reflectionFogged: (rgb: Vec3, start: Vec3, along: Vec3) => Vec3 }>(
      wgslModule(reflectionRayLightWgsl(1)),
      ['reflectionFogged'],
      { directLights: fogLights(fog), reflectionDone: () => on },
    ).reflectionFogged([1, 1, 1], [0, 0, 0], [100, 0, 0])
  const height = { color: [0.5, 0.6, 0.7], density: 0.02 }
  assert.deepEqual(fogged(undefined), [1, 1, 1], 'no fog in the scene')
  assert.deepEqual(fogged(height, false), [1, 1, 1], 'the setting off')
  const seen = fogged(height)
  assert.ok(seen[0] < 1 && seen[2] > seen[0], `the fog’s colour over a hundred metres: ${seen}`)
})

test('the fog’s own cubemap tints the fog laid over a ray while the sky light does not light the fog, read along the ray', () => {
  const lights = fogLights({ color: [1, 1, 1], density: 0.02 })
  // The cubemap on (its switch above a half), not rotated (sine 0, cosine 1), read sharp at any distance.
  lights.fog[FOG_SLOT.cubemap] = [0, 1, 3, 1]
  lights.fog[FOG_SLOT.cubeBlend] = [0, 1, 0, 0]
  const asked: number[][] = []
  const fogged = shaderRun<{ reflectionFogged: (rgb: Vec3, start: Vec3, along: Vec3) => Vec3 }>(
    wgslModule(reflectionRayLightWgsl(1)),
    ['reflectionFogged'],
    {
      directLights: lights,
      reflectionDone: () => true,
      fogCubemap: {},
      fogSampler: {},
      textureSampleLevel: (_t: unknown, _s: unknown, direction: number[]) => {
        asked.push(direction)
        return [0.5, 0.25, 1, 1]
      },
    },
  ).reflectionFogged
  // A black ray seen through the fog is the fog’s in-scattering alone: white fog, so the cubemap’s colour (0.5, 0.25, 1) times what the fog does not let through.
  const seen = fogged([0, 0, 0], [0, 0, 0], [100, 0, 0])
  assert.ok(seen[0] > 0, `${seen}`)
  assert.ok(
    Math.abs(seen[1] / seen[0] - 0.5) < 1e-5 && Math.abs(seen[2] / seen[0] - 2) < 1e-5,
    `${seen}`,
  )
  assert.ok(
    asked.length > 0 &&
      asked.every(([x, y, z]) => x > 0 && Math.abs(y) < 1e-6 && Math.abs(z) < 1e-6),
    'along the ray',
  )
})

test('the sky light that lights the height fog fogs a ray too: read on the sky light’s cube the reflection group binds, mixed into the fog’s colour by its strength', () => {
  const lights = fogLights({ color: [0.5, 0.6, 0.7], density: 0.02 })
  lights.fogView[FOG_VIEW_SLOT.heightFog] = [0, 1, 0.5, 7]
  lights.fogView[FOG_VIEW_SLOT.skyLightColour] = [0.5, 0.25, 2, 0]
  const asked: { layer: number }[] = []
  const { reflectionFogged } = shaderRun<{
    reflectionFogged: (rgb: Vec3, start: Vec3, along: Vec3) => Vec3
  }>(wgslModule(reflectionRayLightWgsl(1)), ['reflectionFogged'], {
    directLights: lights,
    reflectionDone: () => true,
    skyLightCube: {},
    skyLightSampler: {},
    skyLight: { levels: [1, 6, 2, 0] },
    textureSampleLevel: (_t: unknown, _s: unknown, _d: number[], layer: number) => {
      asked.push({ layer })
      return [0.2, 0.4, 0.8, 1]
    },
  })
  // A black ray seen through the fog is the fog's in-scattering alone: with the sky light's whole strength, the sky light's colour (0.1, 0.1, 1.6)
  // times what the fog does not let through.
  const seen = reflectionFogged([0, 0, 0], [0, 0, 0], [100, 0, 0])
  assert.ok(
    seen[0] > 0 && Math.abs(seen[0] - seen[1]) < 1e-6 && seen[2] / seen[0] > 15.9,
    `${seen}`,
  )
  assert.ok(
    asked.length > 0 && asked.every(({ layer }) => layer === 2),
    'the layer the capture has ready',
  )
})

// The sky light that leaks onto what a ray hits is the sky's diffuse light at the HIT'S NORMAL. The reference's function takes (cone direction, hit normal,
// distance) and reads the normal alone; its mesh path calls it in that order but its
// voxel path swaps the first two, so a hit there reads the sky's diffuse light at the RAY'S direction.
const same = (a: number[], b: number[], what: string) =>
  a.forEach((c, k) => assert.ok(Math.abs(c - b[k]) < 1e-6, `${what}: ${a} against ${b}`))

test('the sky light leaking onto a hit is read at the hit’s normal, never at the ray’s direction', () => {
  // A sky brightest overhead: the diffuse light at a unit direction `n` is 0.5 + 0.5 n.z, whatever the channel.
  const sky = (n: number[]) => [0.5 + 0.5 * n[2], 0.5 + 0.5 * n[2], 0.5 + 0.5 * n[2]]
  const { reflectionSkylightLeak } = shaderRun<{ reflectionSkylightLeak: (N: Vec3) => Vec3 }>(
    wgslModule(reflectionRayLightWgsl(1)),
    ['reflectionSkylightLeak'],
    { reflectionView: { leak: [1, 1, 1, 0.5] }, skyLit: () => true, skyLightDiffuse: sky },
  )
  // A floor facing the sky (normal +z) hit by a ray going down and forward (0.6, 0, -0.8).
  const floor: Vec3 = [0, 0, 1]
  const ray: Vec3 = [0.6, 0, -0.8]
  const leak = (hitNormal: Vec3) => sky(hitNormal).map((c) => c * 0.5)
  // The reference's call of the voxel path, GetSkylightLeakingForReflections(GeometryWorldNormal, Direction, ...): the first argument is not read, the second is the ray.
  const referenceVoxel = (_coneDirection: Vec3, hitNormal: Vec3) => leak(hitNormal)
  same(
    referenceVoxel(floor, ray),
    [0.05, 0.05, 0.05],
    'the reference’s voxel hit: the sky at the ray, a tenth of the sky',
  )
  same(leak(floor), [0.5, 0.5, 0.5], 'the floor lit by the whole sky')
  same(reflectionSkylightLeak(floor), leak(floor), 'ours: the hit’s normal')
  assert.ok(
    Math.abs(reflectionSkylightLeak(floor)[0] - referenceVoxel(floor, ray)[0]) > 0.4,
    'the two calls differ by ten',
  )
})
