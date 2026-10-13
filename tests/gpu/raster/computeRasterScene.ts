// The tiled scene of the watertight compute-raster proof: tiles tilted at angles that do not
// repeat, a face-on tile whose diagonal falls exactly on pixel centres, a huge tile whose vertices
// round far outside the image, and a tile that crosses the near plane.
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts'
import { VIEWPORT, batisseur, square, type ScenePreparee } from '../kit/sharedSceneProof.ts'
import { perspectiveSlope } from '../../../packages/math/src/projection/camera.ts'
import { DEG2RAD } from '../../../packages/math/src/constants.ts'

/** Pixels of one world unit at this distance from the face-on camera, 55° vertical aperture. */
const pixelsPerUnit = (distance: number): number =>
  VIEWPORT[1] / 2 / perspectiveSlope(55) / distance

export function tileScene(): ScenePreparee {
  const builder = batisseur()
  const material = G.basicSurface({ color: 0x20c040, side: G.DOUBLE_SIDE })
  const place = (name: string, half: number, at: number[], turn = {}, geometry = square(half)) =>
    void (builder.place(material, 'exact-clusters', half, at, turn, geometry).name = name)
  for (let i = 0; i < 12; i++)
    place(
      `tile-${i}`,
      0.45,
      [((i % 4) - 1.5) * 0.7, (Math.floor(i / 4) - 1) * 0.7, -0.2 * (i % 3)],
      { x: 0.3 * i, y: 0.17 * i, z: 0.61 * i },
    )
  // A face-on tile whose corners fall on pixel corners: its 45° diagonal passes through the centre
  // of each pixel it crosses. A pixel exactly on a shared edge is the one two inclusive rules can
  // leave to nobody: the dotted crack. Its pages are bounded as a tile of 0.8.
  place('face', 0.8, [0, 0, 0], {}, square(24 / pixelsPerUnit(3)))
  // A huge tile behind the others, its vertices thousands of pixels outside the image and its
  // diagonal across it: where derived weights round enough to open a crack between its triangles.
  place('huge', 60, [1.3, -0.8, -1.5], { x: 0.05, y: 0.02, z: 0.35 })
  // A large tile with a corner behind the eye: the camera at z = 3, the near plane at z = 2.9;
  // tilted 60°, it crosses that plane in the middle of the image.
  place('near', 3, [0, -2.2, 2.95], { y: 60 * DEG2RAD })
  return builder.fini()
}
