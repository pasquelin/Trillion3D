// The sun's distance-field shadow of an image: whom it is drawn for, and what it is run on.

import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveLightShadow } from '../../../../sdk-core/src/contracts/lightShadowOptions.ts'
import type { DistanceFieldCascade } from '../../../../sdk-core/src/contracts/sunCascades.ts'
import { LIGHT_SETTINGS } from '../../../../sdk-core/src/scene/light/contracts.ts'
import { createSunShadowState } from '../../lighting/distanceField/shadow/state.ts'
import { encodeSunFieldShadow } from './encodeSunFieldShadow.ts'
import { sunsOf } from './sunFieldLights.ts'
import type { WebgpuPagesRuntime } from '../backend/runtime.ts'
import type { EngineCamera } from '../../camera/engineCamera.ts'

const CASCADE: DistanceFieldCascade = {
  ...{ near: 400, far: 512, minDepth: 373, maxDepth: 512 },
  ...{ fadeOffset: 500, invFadeLength: 1 / 12, nearFadeOffset: 373, invNearFadeLength: 1 / 27 },
}

/** A sun in the plan: its direction, its cascade and its settings. */
const sun = (cascade: DistanceFieldCascade | undefined, id = 'sun') => ({
  clipmap: {
    light: {
      ...{ id, direction: [0, -3, 4], cascades: cascade && { edge: 427, distanceField: cascade } },
      shadow: resolveLightShadow({
        distanceFieldTraceDistance: 50,
        distanceFieldRayStartOffset: 0.01,
      }),
    },
  },
})

/** A runtime whose device refuses the first layout it is asked for: reaching it is `reached`. */
function runtime(
  plan: unknown[],
  {
    meshes = { generation: 1, count: 3 },
    context = {} as object,
    main = true,
    angularRadius = 0.004 as number | null,
  } = {},
) {
  const state = createSunShadowState()
  const device = {
    limits: { maxTextureDimension2D: 8192 },
    createBindGroupLayout() {
      throw new Error('reached')
    },
  }
  const view = { overrides: { lighting: true } }
  const rt = {
    context,
    distanceFields: { scene: { meshes }, sunShadow: state },
    views: { active: main ? view : { overrides: view.overrides }, main: view },
    gpu: {
      ...{ device, targetSize: [64, 32], allocatedSize: [64, 32] },
      surfaces: { views: () => [{}, {}, {}, {}], subsurfaceView: {} },
    },
    vis: { gpuHiz: { depth: () => ({}) } },
    run: { depthDrawn: true, diagnostic: 'beauty', frame: 1 },
    lights: {
      store: {
        unlit: false,
        light: () => (angularRadius === null ? undefined : { angularRadius }),
      },
      vsm: { plan: { lights: plan, projected: plan } },
    },
  } as unknown as WebgpuPagesRuntime
  return { rt, state }
}

const cam = {
  ...{ world: [], projection: [], viewProjection: [], eye: [0, 0, 0] },
  ...{ near: 0.1, far: 1000, perspective: 1 },
} as unknown as EngineCamera

test('the cascade is traced for the suns that have one, by the channel of their shadow maps', () => {
  const { rt, state } = runtime([sun(undefined, 'moon'), sun(CASCADE)])
  const lights = sunsOf(rt, state)
  assert.equal(lights.length, 1)
  assert.equal(lights[0].lane, 1, 'the second light of the plan: its lane')
  const [x, y, z] = lights[0].toLight
  assert.ok(
    Math.abs(x) + Math.abs(y - 0.6) + Math.abs(z + 0.8) < 1e-9,
    'toward the light: against its direction',
  )
  assert.equal(lights[0].traceDistance, 50)
  assert.equal(lights[0].rayStartOffset, 0.01)
  assert.equal(lights[0].angularRadius, 0.004)
  assert.equal(lights[0].cascade, CASCADE)
  // Past the fourth light of the plan there is no lane.
  const crowd = runtime([...Array(4)].map(() => sun(undefined)).concat(sun(CASCADE)))
  assert.equal(sunsOf(crowd.rt, crowd.state).length, 0)
})

test('a sun asking for hard shadows (angularRadius 0) is traced as hard, one the store does not hold gets the default disk', () => {
  const radius = (angularRadius: number | null) => {
    const { rt, state } = runtime([sun(CASCADE)], { angularRadius })
    return sunsOf(rt, state)[0].angularRadius
  }
  assert.equal(radius(0), 0, 'the maps trace a point; so does the cascade')
  assert.equal(radius(0.004), 0.004)
  assert.equal(radius(null), LIGHT_SETTINGS.sunAngularRadius)
})

test('the pass runs, on the cascade of a sun, every mesh being made of clusters the shadow maps take', () => {
  // The lists are empty — every mesh is made of clusters — but the passes are run, as they are in the reference.
  const open = runtime([sun(CASCADE)])
  assert.throws(() => encodeSunFieldShadow(open.rt, {} as GPUCommandEncoder, cam), /reached/)
})

test('the pass is drawn for the main view’s lit image of a scene with fields and a cascade alone', () => {
  const drawn = (options: Parameters<typeof runtime>[1], plan = [sun(CASCADE)]) => {
    const { rt } = runtime(plan, options)
    try {
      encodeSunFieldShadow(rt, {} as GPUCommandEncoder, cam)
      return false
    } catch (error) {
      return (error as Error).message === 'reached'
    }
  }
  assert.equal(drawn({}), true)
  assert.equal(drawn({ main: false }), false, 'a view drawn aside')
  assert.equal(drawn({ meshes: { generation: 0, count: 3 } }), false, 'no field made yet')
  assert.equal(drawn({ meshes: { generation: 1, count: 0 } }), false, 'no mesh')
  assert.equal(drawn({}, [sun(undefined)]), false, 'no cascade')
  assert.equal(drawn({}, []), false, 'no shadowed light')
})
