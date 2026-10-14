// Page of the material-edit proof: the real WebGPU engine lit by the bench sun (`sunlitEngine`) on
// an opaque lit square behind a glass with a volume. A session draws them, then the host rewrites
// in place the opaque surface's colour and roughness, then the glass's attenuation colour
// (`surfaceWritten`, `refreshMaterials`); a session opened on the new values draws the reference.
// The page reports both held images and the rows each edit sent up.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { batisseur, cameraFace } from '../kit/sharedSceneProof.ts'
import { countsStep, sunlitEngine, untilHeld } from '../kit/sceneImageProof.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { compareImages } from '../../../packages/sdk-core/src/runtime/compareImages.ts'
import { surfaceWritten } from '../../../packages/sdk-browser/src/page/surfaceWrites.ts'
import type { PageSurface } from '../../../packages/sdk-browser/src/page/surface.ts'
import type { Engine } from '../../../packages/sdk-browser/src/engine/types.ts'

/** The values the edits write. */
const COLOUR: [number, number, number] = [0.8, 0.35, 0.1],
  ROUGHNESS = 0.3,
  ATTENUATION: [number, number, number] = [0.2, 0.6, 0.9]

/** The opaque lit square and, before it, the glass with a red volume. */
function scene() {
  const builder = batisseur()
  const lit = (half: number) => G.planeGeometry(2 * half, 2 * half)
  const wall = G.standardSurface({ color: 0x2244aa, roughness: 0.8, side: G.DOUBLE_SIDE })
  const glass = G.physicalSurface({
    ...{ color: 0xffffff, metalness: 0, roughness: 0, transmission: 1, ior: 1.5 },
    ...{ thickness: 0.5, transparent: true, side: G.DOUBLE_SIDE },
    ...{ attenuationColor: 0xff0000, attenuationDistance: 0.2 },
  })
  builder.place(wall, 'exact-clusters', 4, [0, 0, -1], {}, lit(4))
  builder.place(glass, 'clustered-blend', 0.8, [0, 0, 0], {}, lit(0.8))
  return { prepared: builder.fini(), wall, glass }
}

/** The opaque square's new colour and roughness. */
const repaintWall = (wall: PageSurface) => {
  wall.baseColor = [...COLOUR]
  wall.roughness = ROUGHNESS
}
/** The glass's new attenuation colour. */
const repaintGlass = (glass: PageSurface) => {
  glass.attenuationColor = [...ATTENUATION]
}

/** The held image of `backend`, and the rows the frames drawn until it sent up. */
async function held(backend: Engine) {
  let rows = 0
  const camera = cameraFace()
  const frames = await untilHeld(backend, camera, () => {
    rows += countsStep(backend, 'encode')?.rowsUploaded ?? 0
  })
  return {
    pixels: Uint8Array.from(frames.held ?? frames.rendered ?? []),
    held: !!frames.held,
    rows,
  }
}

/** What the proof reads: each image held, the rows each edit sent up, and the pixels the edited
 *  session's images differ from the sessions opened on the values. */
export type Edits = {
  held: boolean[]
  wallRows: number
  glassRows: number
  wallDiffers: number
  glassDiffers: number
}

export const run = () =>
  runOnDevice<Edits>(async (device, events, result) => {
    const options = { stageProfile: true }
    // The session the host edits in place.
    const edited = scene()
    const live = await sunlitEngine(edited.prepared, device, events, options)
    let wallImage: Awaited<ReturnType<typeof held>> | undefined,
      glassImage: Awaited<ReturnType<typeof held>> | undefined
    try {
      const first = await held(live.backend)
      repaintWall(edited.wall)
      surfaceWritten(edited.wall)
      live.backend.refreshMaterials?.(true)
      wallImage = await held(live.backend)
      repaintGlass(edited.glass)
      surfaceWritten(edited.glass)
      live.backend.refreshMaterials?.(true)
      glassImage = await held(live.backend)
      result.held = [first.held, wallImage.held, glassImage.held]
      result.wallRows = wallImage.rows
      result.glassRows = glassImage.rows
    } finally {
      await live.release()
    }
    // The sessions opened on the new values: the wall's alone, then both.
    const opened = async (glassToo: boolean) => {
      const fresh = scene()
      repaintWall(fresh.wall)
      if (glassToo) repaintGlass(fresh.glass)
      const session = await sunlitEngine(fresh.prepared, device, events, options)
      try {
        return (await held(session.backend)).pixels
      } finally {
        await session.release()
      }
    }
    result.wallDiffers = compareImages(wallImage!.pixels, await opened(false)).differentPixels
    result.glassDiffers = compareImages(glassImage!.pixels, await opened(true)).differentPixels
  })
