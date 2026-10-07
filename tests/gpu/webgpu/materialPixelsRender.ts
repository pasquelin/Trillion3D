// Rendering one material fixture on each renderer: the witness renderer, the prepared scene, and
// the images compared point by point. Split from `materialPixelsPage.ts` (fixture run and
// comparison) to keep each file under the line gate.
import * as THREE from 'three/webgpu'
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { threeCamera } from '../../../bench/witnesses/three/fromGraphNodes.ts'
import { witnessScene } from '../../../bench/witnesses/three/displayObjects.ts'
import {
  createWitnessRenderer,
  readWitnessImage,
} from '../../../bench/runner/witness/threeRenderer.ts'
import { batisseur, engine, release, type ScenePreparee } from '../kit/sharedSceneProof.ts'
import { untilHeld } from '../kit/sceneImageProof.ts'
import { SIZE, type Fixture } from './materialFixtureShape.ts'
import type { EngineDiagnostic } from '../../../packages/sdk-browser/src/engine/types.ts'
import type * as SdkCore from '../../../packages/sdk-core/src/index.ts'

/** Background the page and both engines clear to, so an uncovered pixel is one colour. */
export const CLEAR_COLOR = 0x2a303c

/** The witness renderer — Three's WebGPU renderer, sRGB output at exposure 1 — on a canvas of the
 *  fixtures' side. */
export async function witnessRenderer() {
  const canvas = document.createElement('canvas')
  document.body.append(canvas)
  const renderer = await createWitnessRenderer(canvas, { width: SIZE, height: SIZE })
  return { renderer, canvas }
}

/** The side of the fixture's square, and the side and depth of the square behind it. */
export const SQUARE_SIDE = 2,
  BEHIND = { side: 4, z: -1 }

/** The fixture's square: a lit one carries normals, a normal-mapped one its tangents. */
function square(fixture: Fixture): G.Geometry {
  const geometry = G.planeGeometry(SQUARE_SIDE, SQUARE_SIDE)
  if (fixture.tangents)
    geometry.setAttribute(
      'tangent',
      G.floatAttribute(Array.from({ length: 4 }, () => [1, 0, 0, 1]).flat(), 4),
    )
  return geometry
}

/** The prepared scene of one fixture: its square, what stands behind it, and the sun when lit. */
export function sceneOf(fixture: Fixture, sun: G.Object3D): ScenePreparee {
  const builder = batisseur()
  const material = fixture.material()
  const mesh = G.mesh(square(fixture), material)
  if (fixture.back) mesh.rotation.y = Math.PI
  if (fixture.tilt) mesh.rotation.x = fixture.tilt
  builder.source.add(mesh)
  builder.add(mesh, material.transparent ? 'clustered-blend' : 'exact-clusters', 1)
  if (fixture.behind !== undefined) {
    const back = G.mesh(
      G.planeGeometry(BEHIND.side, BEHIND.side),
      G.basicSurface({ color: fixture.behind }),
    )
    back.position.z = BEHIND.z
    builder.source.add(back)
    builder.add(back, 'exact-clusters', 2)
  }
  if (fixture.lit) builder.source.add(sun)
  return builder.fini()
}

/** RGB at `(x, y)` of a bottom-left RGBA image of `SIZE` columns. */
export const rgbAt = (pixels: ArrayLike<number>, [x, y]: number[]): number[] =>
  [0, 1, 2].map((k) => pixels[(y * SIZE + x) * 4 + k])

/** The witness image of a prepared scene, bottom-left rows: the source's meshes and lights copied
 *  into the library, drawn the way the explorer draws a witness — the filmic curve once a light
 *  exists, identity without one —; the scene is left for the engine. */
export async function witnessImage(
  scene: ScenePreparee,
  renderer: THREE.WebGPURenderer,
  camera: G.Camera,
): Promise<Uint8Array> {
  const witness = witnessScene(scene.source, CLEAR_COLOR)
  try {
    renderer.toneMapping = witness.lit() ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping
    witness.update()
    return await readWitnessImage(renderer, witness.scene, threeCamera(camera))
  } finally {
    witness.dispose()
  }
}

/** The engine image of a prepared scene, held when the engine holds it, the last rendered one
 *  otherwise; releases the scene. */
export async function engineImage(
  scene: ScenePreparee,
  device: GPUDevice,
  sceneLights: SdkCore.SceneLightStore,
  camera: G.Camera,
  events: EngineDiagnostic[],
): Promise<{ pixels: number[] | undefined; held: boolean }> {
  const { backend, canvas } = engine(scene, device, (e: EngineDiagnostic) => events.push(e), {
    clearColor: CLEAR_COLOR,
    sceneLights,
  })
  try {
    await backend.prepare()
    const { held, rendered } = await untilHeld(backend, camera)
    return { pixels: held ?? rendered, held: held !== null }
  } finally {
    release(backend, canvas, scene)
  }
}
