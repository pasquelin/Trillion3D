// Page of the glass proof: the real WebGPU engine on built scenes (`sharedSceneProof.ts`) lit by
// the bench sun, an opaque blue backdrop filling the view. Over it, a clear glass square — fully
// transmissive, index 1.5, half a unit thick —; the same glass with a red volume that stops blue
// within a few hundredths of a unit; an opaque red tile in front of the glass, and the same tile
// without the glass; the glass moved out of view; and the backdrop alone.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { createSceneLightStore } from '../../../packages/sdk-core/src/index.ts'
import { SUN } from '../../../bench/runner/lighting/lamps.ts'
import { batisseur, cameraFace, engine, release } from '../kit/sharedSceneProof.ts'
import { colorAt, difference, untilHeld } from '../kit/sceneImageProof.ts'
import { runOnDevice } from '../kit/deviceProof.ts'

/** What stands before the backdrop: the glass where it is (`at`, its centre on `x`), its volume,
 *  and the opaque tile in front of it. */
interface Layout {
  glass?: { at: number; volume: boolean }
  front?: boolean
}

const glass = (volume: boolean) =>
  G.physicalSurface({
    color: 0xffffff,
    metalness: 0,
    roughness: 0,
    transmission: 1,
    ior: 1.5,
    thickness: 0.5,
    transparent: true,
    side: G.DOUBLE_SIDE,
    ...(volume ? { attenuationColor: 0xff0000, attenuationDistance: 0.05 } : {}),
  })

function scene({ glass: placed, front }: Layout) {
  const builder = batisseur()
  const add = (surface: G.GraphSurface, pass: string, z: number, half: number, x = 0) => {
    // A lit square carries its normals: the plane of the graph, not the proofs' bare square.
    const mesh = G.mesh(G.planeGeometry(2 * half, 2 * half), surface)
    mesh.position.set(x, 0, z)
    builder.source.add(mesh)
    builder.add(mesh, pass, half)
  }
  add(G.basicSurface({ color: 0x2244aa, side: G.DOUBLE_SIDE }), 'exact-clusters', -1, 4)
  if (placed) add(glass(placed.volume), 'clustered-blend', 0, 0.8, placed.at)
  if (front) add(G.basicSurface({ color: 0xcc2222 }), 'exact-clusters', 0.5, 0.25)
  return builder.fini()
}

/** The held image of `layout`: its pixels at the centre, and all of them (kept in the page). */
async function imageOf(device: GPUDevice, events: unknown[], layout: Layout) {
  const prepared = scene(layout),
    camera = cameraFace()
  const sceneLights = createSceneLightStore()
  sceneLights.add(SUN)
  const { backend, canvas } = engine(prepared, device, (e) => events.push(e), {
    sceneLights,
  })
  try {
    await backend.prepare()
    const { held, rendered } = await untilHeld(backend, camera)
    const pixels = Uint8Array.from(held ?? rendered ?? [])
    return { held: held !== null, centre: colorAt(pixels, camera, 0, 0), pixels }
  } finally {
    release(backend, canvas, prepared)
  }
}

/** What a layout's image tells the proof: whether it held, and its centre. */
type Image = { held: boolean; centre: number[] }
/** Every layout's image, by name; and how many pixels the glass out of view changed of the
 *  backdrop's image, the one comparison of whole images, made here. */
export type Images = Record<
  'bare' | 'clear' | 'volume' | 'front' | 'frontAlone' | 'away',
  Image
> & {
  awayChanged: number
}

export const run = () =>
  runOnDevice<Images>(async (device, events, result) => {
    const shot = async (layout: Layout) => {
      const { held, centre, pixels } = await imageOf(device, events, layout)
      return { image: { held, centre }, pixels }
    }
    const bare = await shot({})
    result.bare = bare.image
    result.clear = (await shot({ glass: { at: 0, volume: false } })).image
    result.volume = (await shot({ glass: { at: 0, volume: true } })).image
    result.front = (await shot({ glass: { at: 0, volume: false }, front: true })).image
    result.frontAlone = (await shot({ front: true })).image
    const away = await shot({ glass: { at: 40, volume: false } })
    result.away = away.image
    result.awayChanged = difference(away.pixels, bare.pixels)
  })
