// Page side of the material proof: each fixture rendered by the WebGPU engine and read at its
// points; a fixture that declares a ground truth is measured against it (`materialTruth.ts`).
import type { Camera } from '../../../packages/sdk-core/src/world/camera/camera.ts'
import type { Object3D } from '../../../packages/sdk-core/src/world/object/object3d.ts'
import { directionalLight } from '../../../packages/sdk-browser/src/scene/host/graph/graphLights.fixture.ts'
import { Color } from '../../../packages/sdk-core/src/world/math/color.ts'
import { cameraFace } from '../../kit/device/sharedSceneProof.ts'
import { openGpuDevice } from '../../kit/device/webgpuDevice.ts'
import { fixtures } from './materialFixtures.ts'
import { SUN, type Fixture } from './materialFixtureShape.ts'
import { truthOf, type TruthReading } from './materialTruth.ts'
import { sceneOf, rgbAt, engineImage, CLEAR_COLOR } from './materialPixelsRender.ts'
import type { EngineDiagnostic } from '../../../packages/sdk-browser/src/diagnostic/types.ts'
import { backgroundRgb } from '../../../bench/oracles/browser/cpu-image/math.ts'
import {
  createSceneLightStore,
  type SceneLightStore,
} from '../../../packages/sdk-core/src/scene/light/store.ts'

interface Sides {
  device: GPUDevice
  camera: Camera
  sun: Object3D
  stores: { none: SceneLightStore; sun: SceneLightStore }
}

interface Reading {
  point: number[]
  engine: number[]
}

interface Comparison {
  name: string
  events: EngineDiagnostic[]
  samples: Reading[]
  /** The sample points where the engine shows the background although a surface stands behind the
   *  fixture (`behind`). */
  holes?: number
  /** The engine against the ground truth (`groundTruth.ts`), where the fixture declares one. */
  truth?: TruthReading
}

/** The display background, one 8-bit step either way per channel. */
const CLEAR_RGB = backgroundRgb(CLEAR_COLOR)
const isClear = (rgb: ArrayLike<number>) => CLEAR_RGB.every((c, k) => Math.abs(rgb[k] - c) <= 1)

/** One fixture drawn by the engine, on a scene of its own the engine releases. */
async function drawn(fixture: Fixture, sides: Sides, events: EngineDiagnostic[]) {
  const scene = sceneOf(fixture, sides.sun)
  const lights = fixture.lit ? sides.stores.sun : sides.stores.none
  return engineImage(scene, sides.device, lights, sides.camera, events)
}

/** One fixture on the engine: the readings at its points and the engine's diagnostics. */
async function compare(fixture: Fixture, sides: Sides): Promise<Comparison> {
  const events: EngineDiagnostic[] = []
  const engine = await drawn(fixture, sides, events)
  const truth = truthOf(fixture, sides.camera, engine.pixels)
  const samples = fixture.points.map((point) => ({ point, engine: rgbAt(engine.pixels, point) }))
  return {
    name: fixture.name,
    events,
    samples,
    holes:
      fixture.behind !== undefined
        ? samples.filter((sample) => isClear(sample.engine)).length
        : undefined,
    truth,
  }
}

/** Runs every fixture on the engine: the readings, the GPU errors nothing captured, and the
 *  adapter they were read on. */
export async function run() {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('no WebGPU adapter')
  const { device, errors } = gpu
  // The sun of the fixtures and the stores of the engine, built once: a light added to another
  // scene moves there, and an unlit fixture reads the empty store.
  const sun = directionalLight(new Color(SUN.color), SUN.intensity)
  const [dx, dy, dz] = SUN.direction ?? [0, -1, 0]
  sun.position.set(-dx, -dy, -dz)
  sun.target.position.set(0, 0, 0)
  const stores = { none: createSceneLightStore(), sun: createSceneLightStore() }
  stores.sun.add(SUN)
  // The engine is asked for an exposure of 1 with no display curve and no vignette.
  stores.sun.setEnvironment({ exposure: 1, toneMapping: 'none', vignette: 0 })
  const sides: Sides = { device, camera: cameraFace(), sun, stores }
  const results: Comparison[] = []
  for (const fixture of fixtures) results.push(await compare(fixture, sides))
  const info = await gpu.fermer()
  return { results, errors, gpu: info.court }
}
