// The engine side of the reflection proof: a synthetic still frame — a mirror floor and an emissive
// quad standing on it, seen by an infinite reversed perspective (`mirrorScene.ts`) — laid in the
// engine's own inputs and run through its kernels as an image runs them (`rig.ts`). Twice: two
// consecutive still images, whose reflection targets are read back to the bit.
import { PHYSICAL_SURFACE_FLAG } from '../../../packages/sdk-browser/src/scene/physicalLobes.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { MIRROR, mirrorScene } from './mirrorScene.ts'
import { openRig } from './rig.ts'
import { MODEL_FLAG } from '../../../packages/sdk-browser/src/scene/surfaceModel.ts'

/** What the proof reads: per reflective family, three consecutive still images' reflection
 *  targets, as raw half-float words. */
export type MirrorReading = { families: Record<string, number[][]>; size: number }

/** The reflective families the rig draws, by name: the mirror floor, rough floors, a coated one. */
const FAMILIES = {
  mirror: () => roughFloor(false, 0),
  'rough 0.35': () => roughFloor(false, 0.35),
  'rough 0.9': () => roughFloor(false, 0.9),
  'coated rough': () => roughFloor(true, 0.9),
}

export function run() {
  return runOnDevice<MirrorReading>(async (device, _events, result) => {
    result.families = {}
    for (const [name, made] of Object.entries(FAMILIES)) {
      const rig = await openRig(device, made())
      // The first image has no radiance pyramid yet: the environment alone; the next three reflect
      // the lit image, the HDR targets taking turns between them.
      rig.image()
      const targets: number[][] = []
      for (let k = 0; k < 3; k++) {
        rig.image()
        targets.push(Array.from(await rig.read()))
      }
      rig.dispose()
      result.families[name] = targets
    }
    result.size = MIRROR.size
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
    if (scene.flags[p] !== MODEL_FLAG.physical) continue
    scene.normals[p * 4 + 3] = rough
    if (!coat) continue
    scene.flags[p] |= PHYSICAL_SURFACE_FLAG
    // No anisotropy; a coat of one on the normal (0, 1, 0), roughness zero: the words
    // `physicalTexel` writes — the octahedral map of +y is (0, 1), the unorm pair (0, 1).
    lobes.set([0, OCT_UP, COAT_ONE, 0], p * 4)
  }
  if (coat) scene.lobes = lobes
  return scene
}

/** The floor's roughness: its own lobe is wide, the coat's the narrowest the engine allows. */
const ROUGH = 0.9
/** The octahedral word of the normal +y (`lobeOctEncode`), and the unorm pair (strength 0, coat 1). */
const OCT_UP = 0x7fff0000
const COAT_ONE = 0xffff0000

export function runCoat() {
  return runOnDevice<CoatReading>(async (device, _events, result) => {
    const { size } = MIRROR
    for (const coat of [false, true]) {
      const rig = await openRig(device, roughFloor(coat))
      rig.image()
      rig.image()
      result[coat ? 'coated' : 'bare'] = Array.from(await rig.read())
      rig.dispose()
    }
    result.size = size
  })
}
