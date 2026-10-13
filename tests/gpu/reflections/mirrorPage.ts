// The engine side of the reflection proof: a synthetic still frame — a mirror floor and an emissive
// quad standing on it, seen by an infinite reversed perspective (`mirrorScene.ts`) — laid in the
// engine's own inputs and run through its kernels as an image runs them (`rig.ts`). Twice: two
// consecutive still images, whose reflection targets are read back to the bit.
import { PHYSICAL_SURFACE_FLAG } from '../../../packages/sdk-browser/src/scene/physicalLobes.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { MIRROR, mirrorScene } from './mirrorScene.ts'
import { openRig } from './rig.ts'

/** What the proof reads: each image's reflection target, as its raw half-float words. */
export type MirrorReading = { targets: number[][]; size: number }

/** The rig over the mirror scene `scene` (`mirrorScene`): its floor a polished metal, white and of
 *  metalness one, so that the share is the lobe's own weight; its pixels wear `lobes` if given. */
export function openMirror(
  device: GPUDevice,
  scene = mirrorScene(),
  lobes?: Uint32Array<ArrayBuffer>,
) {
  const { size } = MIRROR
  return openRig(device, {
    size: [size, size],
    viewProjection: scene.viewProjection,
    eye: [0, 0, 0],
    depth: scene.depth,
    flags: scene.flags,
    normals: scene.normals,
    base: new Float32Array(size * size * 4).fill(1),
    radiance: scene.radiance,
    lobes,
  })
}

export function run() {
  return runOnDevice<MirrorReading>(async (device, _events, result) => {
    const { size } = MIRROR
    const rig = await openMirror(device)
    // The first image has no radiance pyramid yet: the environment alone, then the lit image's.
    rig.image()
    result.targets = []
    for (let k = 0; k < 2; k++) {
      rig.image()
      result.targets.push(Array.from(await rig.read()))
    }
    result.size = size
    rig.dispose()
  })
}

/** What the coat proof reads: the reflection target of a rough metal floor, bare and under a clear
 *  coat, as raw half-float words. */
export type CoatReading = { bare: number[]; coated: number[]; size: number }

/** The floor of the scene turned into a metal of roughness `rough` (`ROUGH` by default), under a
 *  clear coat of the strength `coat` on its own normal and as smooth as the floor of roughness
 *  allows, or bare. */
export function roughFloor(coat: boolean, rough = ROUGH) {
  const scene = mirrorScene()
  const { size } = MIRROR
  const lobes = new Uint32Array(size * size * 4)
  for (let p = 0; p < size * size; p++) {
    if (scene.flags[p] !== STANDARD) continue
    scene.normals[p * 4 + 3] = rough
    if (!coat) continue
    scene.flags[p] |= PHYSICAL_SURFACE_FLAG
    // No anisotropy; a coat of one on the normal (0, 1, 0), roughness zero: the words
    // `physicalTexel` writes — the octahedral map of +y is (0, 1), the unorm pair (0, 1).
    lobes.set([0, OCT_UP, COAT_ONE, 0], p * 4)
  }
  return { scene, lobes: coat ? lobes : undefined }
}

/** The surface flag of a lit standard surface (`scene/surfaceModel.ts`), the floor's. */
const STANDARD = 2
/** The floor's roughness: its own lobe is wide, the coat's the narrowest the engine allows. */
const ROUGH = 0.9
/** The octahedral word of the normal +y (`lobeOctEncode`), and the unorm pair (strength 0, coat 1). */
const OCT_UP = 0x7fff0000
const COAT_ONE = 0xffff0000

export function runCoat() {
  return runOnDevice<CoatReading>(async (device, _events, result) => {
    const { size } = MIRROR
    for (const coat of [false, true]) {
      const { scene, lobes } = roughFloor(coat)
      const rig = await openMirror(device, scene, lobes)
      rig.image()
      rig.image()
      result[coat ? 'coated' : 'bare'] = Array.from(await rig.read())
      rig.dispose()
    }
    result.size = size
  })
}
