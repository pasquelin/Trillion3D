// Page of the blend passes proof: the real WebGPU engine on built scenes (`sharedSceneProof.ts`),
// unlit, before an opaque blue backdrop. Two half-transparent tiles, red and green, overlap in the
// middle of the view, the red one nearer, then the green one; above them a double-sided and a
// front-only transparent tile, both turned to show their back; below them two masked tiles, one
// whose opacity passes its cutoff and one whose opacity does not, and a hidden transparent tile.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { batisseur, cameraFace, engine, release, square } from '../kit/sharedSceneProof.ts'
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

/** A tile of half-side `half` at `(x, y, z)`, in `surface`, drawn by `pass`. */
function tile(
  builder: ReturnType<typeof batisseur>,
  surface: G.GraphSurface,
  pass: string,
  [x, y, z]: number[],
  half = 0.3,
) {
  const mesh = G.mesh(square(half), surface)
  mesh.position.set(x, y, z)
  builder.source.add(mesh)
  builder.add(mesh, pass, half)
  return mesh
}

const blended = (color: number, side = G.DOUBLE_SIDE, opacity = 0.5) =>
  G.basicSurface({ color, transparent: true, opacity, depthWrite: false, side })

/** The scene: the backdrop, the two overlapping tiles — the red one at `redZ`, the green one at
 *  `greenZ` —, and with `rest` the side, mask and hidden tiles. */
function scene(redZ: number, greenZ: number, rest: boolean) {
  const builder = batisseur()
  tile(
    builder,
    G.basicSurface({ color: 0x0000ff, side: G.DOUBLE_SIDE }),
    'exact-clusters',
    [0, 0, -2],
    4,
  )
  tile(builder, blended(0xff0000), 'clustered-blend', [-0.25, 0, redZ], 0.5)
  tile(builder, blended(0x00ff00), 'clustered-blend', [0.25, 0, greenZ], 0.5)
  if (rest) {
    const turned = [
      tile(builder, blended(0xffff00, G.DOUBLE_SIDE, 0.6), 'clustered-blend', [
        ...AT.doubleSided,
        0,
      ]),
      tile(builder, blended(0xffff00, G.FRONT_SIDE, 0.6), 'clustered-blend', [...AT.frontOnly, 0]),
    ]
    for (const mesh of turned) mesh.rotation.y = Math.PI
    const masked = (opacity: number) =>
      G.basicSurface({ color: 0xff0000, alphaTest: 0.5, opacity, side: G.DOUBLE_SIDE })
    tile(builder, masked(0.8), 'exact-clusters', [...AT.masked, 0])
    tile(builder, masked(0.3), 'exact-clusters', [...AT.cut, 0])
    tile(builder, blended(0xff0000), 'clustered-blend', [...AT.hidden, 0]).visible = false
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
