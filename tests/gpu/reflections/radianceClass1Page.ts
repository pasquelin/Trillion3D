// The page of the radiance pyramid's class-1 proof (`radiance-class1.gpu.ts`). Level 0 of the
// pyramid is the lit image itself, the HDR target the last image lit (`reflections/radiance.ts`),
// where it was a copy of it, its coverage clamped within one and zero past the drawn size.
//
//  - `level0`: the engine's read of level 0 against the copy's, both reads' bits
//    (`radianceLevel0.ts`).
//  - `families`: the reflection targets of generated reflective families (a mirror floor, rough
//    floors, a coated rough floor) through the engine's kernels (`rig.ts`), three still images in a
//    row, the HDR targets taking turns between them; and the held images of the glass panes
//    through the whole engine (`glassPage.ts`), blended and transmissive.
import { runOnDevice } from '../kit/deviceProof.ts'
import { imageOf } from './glassPage.ts'
import { openMirror, roughFloor } from './mirrorPage.ts'
import { level0, LIT_IMAGES } from './radianceLevel0.ts'
import { createScreenReflection } from '../../../packages/sdk-browser/src/reflections/gpu.ts'

/** Whether the pyramid reads its level 0 in place, the lit image itself. */
function inPlace(device: GPUDevice) {
  const reflection = createScreenReflection(device, 4, 4, false)
  const held = 'image' in reflection.radiance
  reflection.dispose()
  return held
}

/** The reflective families the rig draws, by name. */
const FAMILIES = {
  mirror: () => roughFloor(false, 0),
  'rough 0.35': () => roughFloor(false, 0.35),
  'rough 0.9': () => roughFloor(false, 0.9),
  'coated rough': () => roughFloor(true, 0.9),
}

/** What the page reads. */
export type Class1Reading = {
  level0: {
    size: readonly number[]
    drawn: readonly number[]
    taps: number
    differ: number
    nonzero: number
  }[]
  /** Per family, its three still images' reflection targets, raw half-float words. */
  families: Record<string, number[][]>
  /** Per glass kind, its held image (RGBA bytes) and whether it was held. */
  glass: Record<string, { held: boolean; pixels: number[] }>
}

export function run() {
  return runOnDevice<Class1Reading>(async (device, events, result) => {
    result.level0 = []
    // A base branch whose pyramid copies its level 0 has no lit image of its own to read: its run
    // writes the families' reference alone (`radiance-class1.gpu.ts`).
    if (inPlace(device))
      for (const { size, drawn } of LIT_IMAGES)
        result.level0.push({ size, drawn, ...(await level0(device, size, drawn)) })
    result.families = {}
    for (const [name, made] of Object.entries(FAMILIES)) {
      const { scene, lobes } = made()
      const rig = await openMirror(device, scene, lobes)
      // The first image has no pyramid yet; the next three reflect it, the HDR targets taking turns.
      rig.image()
      const targets: number[][] = []
      for (let k = 0; k < 3; k++) {
        rig.image()
        targets.push(Array.from(await rig.read()))
      }
      rig.dispose()
      result.families[name] = targets
    }
    result.glass = {}
    for (const kind of ['blend', 'transmission'] as const)
      result.glass[kind] = await imageOf(device, events, { pane: true, base: true }, kind)
  })
}
