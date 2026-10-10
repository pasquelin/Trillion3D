// A still frame of lit boxes seen by a reversed infinite perspective (`boxes.fixture.ts`), laid in
// the engine's own inputs (`rig.ts`): the depth the boxes rasterize to, a surface flag and a normal
// at every pixel, the colour of the box it shows as its base and as its lit radiance. A mirror box
// is a polished metal (white, metalness one, roughness zero) that reflects; every other box is
// diffuse and reflects nothing.
import {
  camera,
  rasterize,
  type Box,
  type Camera,
  type V3,
} from '../../../packages/sdk-browser/src/reflections/boxes.fixture.ts'
import { DEG2RAD } from '../../../packages/math/src/constants.ts'
import type { RigFrame } from './rigFrame.ts'

/** A box of the frame: its geometry, its colour, and whether it is a mirror. */
export type Block = { box: Box; color: V3; mirror?: boolean }

/** The surface flags of the frame (`scene/surfaceModel.ts`): lit standard, diffuse. */
const STANDARD = 2,
  DIFFUSE = 4

/** The outward normal of the face `face` of a box (`6 · box + face` of `rasterize`): axis `face >> 1`,
 *  the high side when odd. */
function faceNormal(face: number): V3 {
  const normal: V3 = [0, 0, 0]
  normal[face >> 1] = face & 1 ? 1 : -1
  return normal
}

/** The frame of `blocks` seen from `eye` toward `target`, and the view that sees it. */
export function boxFrame(
  blocks: Block[],
  eye: V3,
  target: V3,
  width: number,
  height: number,
  fov = 50 * DEG2RAD,
) {
  const view = camera(eye, target, width, height, fov)
  const { depth, shown } = rasterize(
    view,
    blocks.map((block) => block.box),
  )
  const pixels = width * height
  const frame: RigFrame = {
    size: [width, height],
    viewProjection: view.m,
    eye,
    depth: Float32Array.from(depth),
    flags: new Uint8Array(pixels),
    normals: new Float32Array(pixels * 4),
    base: new Float32Array(pixels * 4),
    radiance: new Float32Array(pixels * 4),
  }
  for (let p = 0; p < pixels; p++) {
    if (shown[p] < 0) continue
    const block = blocks[Math.floor(shown[p] / 6)]
    frame.flags[p] = block.mirror ? STANDARD : DIFFUSE
    frame.normals.set([...faceNormal(shown[p] % 6), block.mirror ? 0 : 1], p * 4)
    frame.base.set(block.mirror ? [1, 1, 1, 1] : [...block.color, 0], p * 4)
    frame.radiance.set([...block.color, 1], p * 4)
  }
  return { frame, view: view as Camera, shown }
}
