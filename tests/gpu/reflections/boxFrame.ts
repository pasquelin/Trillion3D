import type { Vec3 } from '../../../packages/math/src/vector/vectorTuple.ts'
// A still frame of lit boxes seen by a reversed infinite perspective (`boxes.fixture.ts`), laid in
// the engine's own inputs (`rig.ts`): the depth the boxes rasterize to, a surface flag and a normal
// at every pixel, the colour of the box it shows as its base and as its lit radiance. A mirror box
// is a polished metal (white, metalness one, roughness zero) that reflects; every other box is
// diffuse and reflects nothing.
import {
  camera,
  faceNormal,
  rasterize,
  type Box,
  type Camera,
} from '../../../packages/sdk-browser/src/reflections/boxes.fixture.ts'
import { DEG2RAD } from '../../../packages/math/src/constants.ts'
import { paintPixel, rigFrameOf } from './rigFrame.ts'

/** A box of the frame: its geometry, its colour, and whether it is a mirror, of roughness `rough`
 *  (zero by default). */
export type Block = { box: Box; color: Vec3; mirror?: boolean; rough?: number }

/** The vertical field of view a box frame is seen through by default. */
export const BOX_FOV = 50 * DEG2RAD

/** The frame of `blocks` seen from `eye` toward `target`, and the view that sees it. */
export function boxFrame(
  blocks: Block[],
  eye: Vec3,
  target: Vec3,
  width: number,
  height: number,
  fov = BOX_FOV,
) {
  const view = camera(eye, target, width, height, fov)
  const { depth, shown } = rasterize(
    view,
    blocks.map((block) => block.box),
  )
  const pixels = width * height
  const frame = rigFrameOf([width, height], view.m, eye)
  frame.depth.set(depth)
  for (let p = 0; p < pixels; p++) {
    if (shown[p] < 0) continue
    const block = blocks[Math.floor(shown[p] / 6)]
    paintPixel(frame, p, !!block.mirror, faceNormal(shown[p] % 6), block.color, block.rough)
  }
  return { frame, view: view as Camera, shown }
}
