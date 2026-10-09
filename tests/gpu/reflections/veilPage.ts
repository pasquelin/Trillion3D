// A closed room with a white background (`roomFrame.ts`): its glossy floor reflects the room, never
// the background — a ray that leaves the screen finds the room's proxy. No reflected pixel exceeds
// the room's largest radiance, and no two neighbouring pixels differ by more than the room's own
// shades do, along a pan of the view: a veil that covered a region of the image, or a column of it,
// would show. A near mirror under a steep view reflects nothing of the screen (every reflected ray
// rises past its top edge): the room's proxy answers alone, and shows the far wall's colour, a dark
// one, never the background's.
import { fromHalf } from '../../../packages/math/src/float/half.ts'
import { DEG2RAD } from '../../../packages/math/src/constants.ts'
import type { V3 } from '../../../packages/sdk-browser/src/reflections/boxes.fixture.ts'
import { runOnDevice } from '../kit/deviceProof.ts'
import { roomFrame } from './roomFrame.ts'
import { openRig } from './rig.ts'

const WIDTH = 320,
  HEIGHT = 180
/** The face of a block that looks up (`faceOf`: 2 · axis + 1 for the high side of y). */
const TOP = 3
const EYE: V3 = [0, 1.7, -0.3]

/** A view of the room: its yaw in degrees, how far (metres, over ten ahead) its target lies below
 *  the eye, the floor patch's roughness and the far wall's colour (the room's own by default). */
export type VeilCase = { yaw: number; drop: number; rough: number; far?: V3 }

/** What the proof reads, per view: the smallest and the largest reflected value, the largest change
 *  from a floor pixel to its neighbour on the right or below, and the pixels reflected. */
export type VeilReading = {
  poses: { minimum: number; maximum: number; step: number; pixels: number }[]
}

export function run(cases: VeilCase[]) {
  return runOnDevice<VeilReading>(async (device, _events, result) => {
    result.poses = []
    for (const { yaw, drop, rough, far } of cases) {
      const a = yaw * DEG2RAD
      const target: V3 = [EYE[0] + Math.sin(a) * 10, EYE[1] - drop, EYE[2] - Math.cos(a) * 10]
      const { frame, shown, floor } = roomFrame(EYE, target, WIDTH, HEIGHT, rough, far)
      const rig = await openRig(device, frame)
      rig.image()
      rig.image()
      const words = await rig.read()
      rig.dispose()
      // The patch's top, its mirror: the film's two-millimetre edge shows a pixel of side now and then.
      const onFloor = (p: number) =>
        shown[p] >= 0 && Math.floor(shown[p] / 6) === floor && shown[p] % 6 === TOP
      const value = (p: number) => [0, 1, 2].map((c) => fromHalf(words[p * 4 + c]))
      let minimum = Infinity,
        maximum = 0,
        step = 0,
        pixels = 0
      for (let y = 0; y < HEIGHT; y++)
        for (let x = 0; x < WIDTH; x++) {
          const p = y * WIDTH + x
          if (!onFloor(p)) continue
          pixels++
          const v = value(p)
          minimum = Math.min(minimum, ...v)
          maximum = Math.max(maximum, ...v)
          for (const q of [p + 1, p + WIDTH])
            if (q < WIDTH * HEIGHT && onFloor(q) && (q !== p + 1 || x + 1 < WIDTH)) {
              const w = value(q)
              step = Math.max(step, ...v.map((c, k) => Math.abs(c - w[k])))
            }
        }
      result.poses.push({ minimum, maximum, step, pixels })
    }
  })
}
