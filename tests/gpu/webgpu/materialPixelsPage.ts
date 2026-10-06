// Page side of the material proof: each fixture rendered by its pair of renderers — the witness
// and the WebGPU engine unless it names WebGL2 —, one engine for all, then read at the same points.
// The witness is drawn the way the explorer draws a witness engine — sRGB output, the filmic curve
// once a light exists, identity without one — and each engine presents into its own canvas.
import type * as THREE from 'three'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { cameraFace, releaseScene } from '../kit/sharedSceneProof.ts'
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { fixtures } from './materialFixtures.ts'
import { SUN, WITNESS_PAIR, type Fixture, type Renderer } from './materialFixtureShape.ts'
import { truthOf, type TruthReading } from './materialTruth.ts'
import {
  witnessRenderer,
  sceneOf,
  rgbAt,
  witnessImage,
  engineImage,
  webgl2Image,
  CLEAR_COLOR,
} from './materialPixelsRender.ts'
import type {
  BackendFactory,
  BackendDiagnostic,
} from '../../../packages/sdk-browser/src/backend/types.ts'
import { referenceBackend } from '../../../bench/witnesses/referenceBackend.ts'
import { backgroundRgb } from '../../../bench/oracles/browser/cpu-image/math.ts'
import {
  autonomousPagesBackend,
  webgpuPagesBackend,
} from '../../../packages/sdk-browser/src/measurement/measurement.ts'
import {
  createSceneLightStore,
  type SceneLightStore,
} from '../../../packages/sdk-core/src/index.ts'

interface Sides {
  referenceBackend: BackendFactory
  webgpuPagesBackend: BackendFactory
  autonomousPagesBackend: BackendFactory
  device: GPUDevice
  renderer: THREE.WebGLRenderer
  canvas: HTMLCanvasElement
  camera: G.Camera
  sun: G.Object3D
  stores: { none: SceneLightStore; sun: SceneLightStore }
}

interface Reading {
  point: number[]
  reference: number[]
  engine: number[]
  gap: number
}

interface Comparison {
  name: string
  /** The reference, then the renderer read against it. */
  pair: readonly [Renderer, Renderer]
  difference: number[]
  reason: string
  held: boolean
  events: BackendDiagnostic[]
  samples: Reading[]
  /** Pixels where the engine shows the background and the reference a surface (`behind`). */
  holes?: number
  /** Both renderers against the ground truth (`groundTruth.ts`), where the fixture declares one. */
  truth?: TruthReading
}

/** The display background, one 8-bit step either way per channel. */
const CLEAR_RGB = backgroundRgb(CLEAR_COLOR)
const isClear = (pixels: ArrayLike<number>, i: number) =>
  CLEAR_RGB.every((c, k) => Math.abs(pixels[i + k] - c) <= 1)

/** Pixels where `engine` shows the background and `reference` does not. */
function holesOf(reference: ArrayLike<number>, engine: ArrayLike<number>) {
  let holes = 0
  for (let i = 0; i < reference.length; i += 4)
    if (isClear(engine, i) && !isClear(reference, i)) holes++
  return holes
}

/** One fixture drawn by one renderer, on a scene of its own the renderer releases. */
async function drawn(
  renderer: Renderer,
  fixture: Fixture,
  sides: Sides,
  events: BackendDiagnostic[],
): Promise<{ pixels: ArrayLike<number>; held: boolean }> {
  const scene = sceneOf(fixture, sides.sun)
  const { camera } = sides
  const lights = fixture.lit ? sides.stores.sun : sides.stores.none
  if (renderer === 'webgl2') return webgl2Image(sides.autonomousPagesBackend, scene, lights, camera)
  if (renderer === 'webgpu') {
    const { pixels, held } = await engineImage(
      sides.webgpuPagesBackend,
      scene,
      sides.device,
      lights,
      camera,
      events,
    )
    return { pixels: pixels ?? [], held }
  }
  const pixels = witnessImage(sides.referenceBackend, scene, sides.renderer, camera)
  releaseScene(scene)
  return { pixels, held: true }
}

/** One fixture on its pair of renderers: the readings at its points and the engine's
 *  diagnostics. */
async function compare(fixture: Fixture, sides: Sides): Promise<Comparison> {
  const events: BackendDiagnostic[] = []
  const pair = fixture.pair ?? WITNESS_PAIR
  const reference = await drawn(pair[0], fixture, sides, events)
  const engine = await drawn(pair[1], fixture, sides, events)
  const truth = truthOf(fixture, sides.camera, reference.pixels, engine.pixels)
  const { name, difference, reason } = fixture
  return {
    name,
    pair,
    difference,
    reason,
    held: reference.held && engine.held,
    events,
    samples: fixture.points.map((point) => {
      const a = rgbAt(reference.pixels, point),
        b = rgbAt(engine.pixels, point)
      return {
        point,
        reference: a,
        engine: b,
        gap: Math.max(...a.map((c, i) => Math.abs(c - b[i]))),
      }
    }),
    holes: fixture.behind !== undefined ? holesOf(reference.pixels, engine.pixels) : undefined,
    truth,
  }
}

/** Runs every fixture on its pair of renderers: the readings, the GPU errors nothing captured, and
 *  the adapter they were read on. */
export async function run() {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('no WebGPU adapter')
  const { device, errors } = gpu
  const { renderer, canvas } = witnessRenderer()
  // The sun of the witness and the stores of the engine, built once: a light added to another
  // scene moves there, and an unlit fixture reads the empty store.
  const sun = G.directionalLight(new G.Color(SUN.color), SUN.intensity)
  const [dx, dy, dz] = SUN.direction ?? [0, -1, 0]
  sun.position.set(-dx, -dy, -dz)
  sun.target.position.set(0, 0, 0)
  const stores = { none: createSceneLightStore(), sun: createSceneLightStore() }
  stores.sun.add(SUN)
  const sides: Sides = {
    referenceBackend,
    webgpuPagesBackend,
    autonomousPagesBackend,
    device,
    renderer,
    canvas,
    camera: cameraFace(),
    sun,
    stores,
  }
  const results: Comparison[] = []
  try {
    for (const fixture of fixtures) results.push(await compare(fixture, sides))
  } finally {
    renderer.dispose()
    canvas.remove()
  }
  const info = await gpu.fermer()
  return { results, errors, gpu: info.court }
}
