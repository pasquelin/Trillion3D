// The tiled scene of the watertight compute-raster proof: tiles tilted at angles that do not
// repeat, a face-on tile whose diagonal falls exactly on pixel centres, a huge tile whose vertices
// round far outside the image, and a tile that crosses the near plane.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { VIEWPORT, batisseur, square, type ScenePreparee } from '../kit/sharedSceneProof.ts'

/** Pixels of one world unit at this distance from the face-on camera, 55° vertical aperture. */
const pixelsPerUnit = (distance: number): number =>
  VIEWPORT[1] / 2 / Math.tan((55 / 2) * (Math.PI / 180)) / distance

export function tileScene(): ScenePreparee {
  const builder = batisseur()
  const material = G.basicSurface({ color: 0x20c040, side: G.DOUBLE_SIDE })
  const add = (mesh: G.HostMesh, halfSide: number) => {
    builder.source.add(mesh)
    builder.add(mesh, 'exact-clusters', halfSide)
  }
  for (let i = 0; i < 12; i++) {
    const tile = G.mesh(square(0.45), material)
    tile.name = `tile-${i}`
    tile.position.set(((i % 4) - 1.5) * 0.7, (Math.floor(i / 4) - 1) * 0.7, -0.2 * (i % 3))
    tile.rotation.set(0.3 * i, 0.17 * i, 0.61 * i)
    add(tile, 0.45)
  }
  // A face-on tile whose corners fall on pixel corners: its 45° diagonal passes through the centre
  // of each pixel it crosses. A pixel exactly on a shared edge is the one two inclusive rules can
  // leave to nobody: the dotted crack.
  const face = G.mesh(square(24 / pixelsPerUnit(3)), material)
  face.name = 'face'
  add(face, 0.8)
  // A huge tile behind the others, its vertices thousands of pixels outside the image and its
  // diagonal across it: where derived weights round enough to open a crack between its triangles.
  const huge = G.mesh(square(60), material)
  huge.name = 'huge'
  huge.position.set(1.3, -0.8, -1.5)
  huge.rotation.set(0.05, 0.02, 0.35)
  add(huge, 60)
  // A large tile with a corner behind the eye: the camera at z = 3, the near plane at z = 2.9;
  // tilted 60°, it crosses that plane in the middle of the image.
  const near = G.mesh(square(3), material)
  near.name = 'near'
  near.position.set(0, -2.2, 2.95)
  near.rotation.set(0, Math.PI / 3, 0)
  add(near, 3)
  return builder.fini()
}
