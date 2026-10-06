// The scene the transform proofs move: a full-frame opaque background, and a transparent tile
// named `tile` under a `pivot` node. The engine tells the tile apart only by its declared pass and
// its material.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { webgpuPagesBackend } from '../../../packages/sdk-browser/src/webgpu/pages/pages.ts'
import {
  batisseur,
  cameraFace,
  square,
  engine,
  versApi,
  type ScenePreparee,
} from '../kit/sharedSceneProof.ts'

/** Half-width of the transparent tile: the sampling window depends on it, not the reverse. */
const HALF = 0.35
/** The names `setTransform` moves the tile and its parent by. */
export const TILE = 'tile',
  PIVOT = 'pivot'

/** A world matrix for `setTransform`: a pure translation along `x`. */
export const translation = (x: number) => versApi(new G.Matrix4().makeTranslation(x, 0, 0))

/** `paged` chooses the tile's pass: `clustered-blend` sends it through the DAG pages,
 *  `shared-blend` through the unpaged path. */
export function transformScene(paged: boolean): ScenePreparee {
  const builder = batisseur()
  const background = G.mesh(square(4), G.basicSurface({ color: 0x1b3a5c, side: G.DOUBLE_SIDE }))
  background.name = 'background'
  background.position.z = -2
  builder.source.add(background)
  builder.add(background, 'exact-clusters', 4)
  const tile = G.mesh(
    square(HALF),
    G.basicSurface({ color: 0xff2020, transparent: true, opacity: 0.85, side: G.DOUBLE_SIDE }),
  )
  tile.name = TILE
  const pivot = new G.Group()
  pivot.name = PIVOT
  pivot.add(tile)
  builder.source.add(pivot)
  builder.add(tile, paged ? 'clustered-blend' : 'shared-blend', HALF)
  return builder.fini()
}

/** One pass of the transform proofs: the scene, its pages engine on `device` reporting into
 *  `events`, the `setTransform` both proofs drive, and the camera facing the tile. */
export function openPass(device: GPUDevice, paged: boolean, events: unknown[]) {
  const s = transformScene(paged)
  const { backend, canvas } = engine(webgpuPagesBackend, s, device, (e) =>
    events.push({ paged, ...e }),
  )
  if (!backend.setTransform) throw new Error('backend missing setTransform')
  return { s, backend, canvas, setTransform: backend.setTransform, camera: cameraFace() }
}
