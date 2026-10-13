// Page of the blend passes proof: the real WebGPU engine on built scenes (`sharedSceneProof.ts`),
// unlit, before an opaque blue backdrop. Two half-transparent tiles, red and green, overlap in the
// middle of the view, the red one nearer, then the green one; above them a double-sided and a
// front-only transparent tile, both turned to show their back; below them two masked tiles, one
// whose opacity passes its cutoff and one whose opacity does not, and a hidden transparent tile.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { batisseur, cameraFace, engine, release } from '../kit/sharedSceneProof.ts'
import { colorAt, untilHeld } from '../kit/sceneImageProof.ts'
import { runOnDevice } from '../kit/deviceProof.ts'

/** Where each tile stands, its centre in the plane `z = 0`. */
export const AT = {
  overlap: [0, 0],
  redOnly: [-0.6, 0],
  doubleSided: [-0.8, 1],
  frontOnly: [0.8, 1],
  masked: [-0.8, -1],
  cut: [0.8, -1],
  hidden: [0, -1],
  bare: [0, 1],
} as const

const blended = (color: number, side = G.DOUBLE_SIDE, opacity = 0.5) =>
  G.basicSurface({ color, transparent: true, opacity, depthWrite: false, side })

/** The half-side of the side, mask and hidden tiles. */
const TILE = 0.3

/** The scene: the backdrop, the two overlapping tiles — the red one at `redZ`, the green one at
 *  `greenZ` —, and with `rest` the side, mask and hidden tiles. */
function scene(redZ: number, greenZ: number, rest: boolean) {
  const builder = batisseur()
  const backdrop = G.basicSurface({ color: 0x0000ff, side: G.DOUBLE_SIDE })
  builder.place(backdrop, 'exact-clusters', 4, [0, 0, -2])
  builder.place(blended(0xff0000), 'clustered-blend', 0.5, [-0.25, 0, redZ])
  builder.place(blended(0x00ff00), 'clustered-blend', 0.5, [0.25, 0, greenZ])
  if (rest) {
    // Both turned to show their back.
    const back = { y: Math.PI }
    const yellow = (side: number) => blended(0xffff00, side, 0.6)
    builder.place(yellow(G.DOUBLE_SIDE), 'clustered-blend', TILE, [...AT.doubleSided, 0], back)
    builder.place(yellow(G.FRONT_SIDE), 'clustered-blend', TILE, [...AT.frontOnly, 0], back)
    const masked = (opacity: number) =>
      G.basicSurface({ color: 0xff0000, alphaTest: 0.5, opacity, side: G.DOUBLE_SIDE })
    builder.place(masked(0.8), 'exact-clusters', TILE, [...AT.masked, 0])
    builder.place(masked(0.3), 'exact-clusters', TILE, [...AT.cut, 0])
    builder.place(blended(0xff0000), 'clustered-blend', TILE, [...AT.hidden, 0]).visible = false
  }
  return builder.fini()
}

/** The held image of `prepared`, its pixels read at every point of `AT`. */
async function readAt(device: GPUDevice, events: unknown[], prepared: ReturnType<typeof scene>) {
  const camera = cameraFace()
  const { backend, canvas } = engine(prepared, device, (e) => events.push(e))
  try {
    await backend.prepare()
    const { held, rendered } = await untilHeld(backend, camera)
    const pixels = Uint8Array.from(held ?? rendered ?? [])
    const at: Record<string, number[]> = {}
    for (const [name, [x, y]] of Object.entries(AT)) at[name] = colorAt(pixels, camera, x, y)
    return { held: held !== null, at }
  } finally {
    release(backend, canvas, prepared)
  }
}

/** One held image, read at every point of `AT`. */
export type Reading = Awaited<ReturnType<typeof readAt>>

/** The red tile nearer, then the green one nearer. */
export const run = () =>
  runOnDevice<{ redNear: Reading; greenNear: Reading }>(async (device, events, result) => {
    result.redNear = await readAt(device, events, scene(0.2, 0, true))
    result.greenNear = await readAt(device, events, scene(0, 0.2, false))
  })
