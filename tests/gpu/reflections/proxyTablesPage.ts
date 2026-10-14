// The page of the proxy-tables proof (`proxy-tables.gpu.ts`), on the engine's device: the engine's own
// proxy over a world the culling splits in ranges, against the same world held whole.
import { openGpuDevice } from '../kit/webgpuDevice.ts'
import { reporting } from '../kit/reportingDevice.ts'
import { engineWalk } from './proxyEngineWalk.ts'
import { lcgRandom } from '../../../packages/math/src/sequence/random.ts'
import { hypot3 } from '../../../packages/math/src/float/hypot.ts'
import { ceilDiv } from '../../../packages/math/src/scalar/integers.ts'
import { FRAME_ROW_WORDS } from '../../../packages/sdk-browser/src/gpu/dag/types.ts'

/** `count` rays over a field `side` cubes wide spaced three metres apart: half cast down at a cube's
 *  neighbourhood from above, half anywhere. */
function rays(count: number, side: number, seed: number) {
  const next = lcgRandom(seed),
    out = new Float32Array(count * 8),
    span = side * 3 + 4
  for (let i = 0; i < count; i++) {
    const o = [next() * span - 2, 6, next() * span - 2]
    const to =
      i % 2
        ? [next() * span - 2, next() * 2 - 1, next() * span - 2]
        : [o[0] + next() - 0.5, 0.5, o[2] + next() - 0.5]
    if (i % 4 === 3) o[1] = next() * 3 - 1
    const d = to.map((v, a) => v - o[a]),
      length = hypot3(d[0], d[1], d[2]) || 1
    out.set([...o, 1000, ...d.map((v) => v / length), 0], i * 8)
  }
  return out
}

/** The engine's proxy over a world past one storage binding — the device reporting a binding four
 *  fifths of its placements' frame words hold, `past` the first placement past it —, and over the
 *  same world held whole. */
export async function splitWorld({ count, rayCount }: { count: number; rayCount: number }) {
  const gpu = await openGpuDevice()
  if (!gpu) throw new Error('WebGPU must be available')
  const { device, errors } = gpu
  const side = Math.ceil(Math.sqrt(count)),
    cast = rays(rayCount, side, 7)
  const whole = await engineWalk(device, count, cast)
  const past = ceilDiv(count * 4, 5)
  const split = await engineWalk(reporting(device, past * FRAME_ROW_WORDS * 4), count, cast)
  const info = await gpu.fermer()
  return { adapter: info.court, errors, whole, split, past }
}
