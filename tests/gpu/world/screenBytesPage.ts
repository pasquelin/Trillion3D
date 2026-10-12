// The page of the screen-memory proof: the same generated worlds drawn at two sizes, the engine's
// allocation ledger read by label once their image is drawn, in bytes per pixel. A target that
// follows the screen holds the same bytes a pixel at both; the shadows' pools and tables do not.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import { batisseur, cameraFace, engine, release } from '../kit/sharedSceneProof.ts'
import { image } from '../kit/sceneImageProof.ts'
import { runOnDevice } from '../kit/deviceProof.ts'

const SIZES = [
  [640, 400],
  [1280, 800],
] as const
/** What stands before the backdrop. */
export const KINDS = ['opaque', 'glass', 'mirror', 'temporal'] as const
type Kind = (typeof KINDS)[number]

function scene(kind: Kind) {
  const builder = batisseur()
  const add = (surface: G.GraphSurface, pass: string, z: number, half: number) => {
    const mesh = G.mesh(G.planeGeometry(2 * half, 2 * half), surface)
    mesh.position.set(0, 0, z)
    builder.source.add(mesh)
    builder.add(mesh, pass, half)
  }
  add(G.basicSurface({ color: 0x2244aa, side: G.DOUBLE_SIDE }), 'exact-clusters', -1, 4)
  if (kind === 'glass')
    add(
      G.physicalSurface({
        ...{ color: 0xffffff, metalness: 0, roughness: 0, transmission: 1, ior: 1.5 },
        ...{ thickness: 0.5, transparent: true, side: G.DOUBLE_SIDE },
      }),
      'clustered-blend',
      0,
      0.8,
    )
  if (kind === 'mirror')
    add(
      G.standardSurface({ color: 0xffffff, metalness: 1, roughness: 0.04, side: G.DOUBLE_SIDE }),
      'exact-clusters',
      0,
      0.8,
    )
  return builder.fini()
}

/** Bytes a pixel, by label, at each size, for each kind. */
export type ScreenReading = Record<string, Record<string, number>[]>

export const run = () =>
  runOnDevice<{ perPixel: ScreenReading }>(async (device, events, result) => {
    const perPixel: ScreenReading = (result.perPixel = {})
    const camera = cameraFace()
    for (const kind of KINDS)
      for (const [width, height] of SIZES) {
        const prepared = scene(kind),
          sceneLights = createSceneLightStore()
        sceneLights.add(SUN)
        const { backend, canvas } = engine(prepared, device, (e) => events.push(e), {
          sceneLights,
          viewport: [width, height],
          temporalAntialiasing: kind === 'temporal',
        })
        await backend.prepare()
        for (let i = 0; i < 4; i++) await image(backend, camera)
        const bytes: Record<string, number> = {}
        for (const [label, held] of Object.entries(backend.metrics().gpuAllocatedByLabel ?? {}))
          bytes[label] = held / (width * height)
        ;(perPixel[kind] ??= []).push(bytes)
        release(backend, canvas, prepared)
        await device.queue.onSubmittedWorkDone()
      }
  })
