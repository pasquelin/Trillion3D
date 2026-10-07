// The clear coat's maps in the real WebGPU engine (`physicalLobesPage.ts`): its roughness map's
// green scales the coat roughness — a sharp texel draws the lamp's highlight a rough one spreads
// out —, and its normal map bends the coat alone: a texel tilted along x moves the highlight
// along x, a flat one leaves it where the plane's own normal puts it.
//
//   node bench/dawn/proofs.ts tests/gpu/visibility/clearcoat-maps.gpu.ts
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { assertSoundProof, runPageProof } from '../kit/enginePageProof.ts'
import type { LobeReading } from './physicalLobesPage.ts'

test("the coat's roughness map sharpens it, and its normal map moves its highlight", async () => {
  const result = await runPageProof(
    resolve(import.meta.dirname, 'physicalLobesPage.ts'),
    'physicalLobes',
    'coatMaps',
  )
  assertSoundProof(result)
  const { sharp, rough, flat, tilted } = (
    result as typeof result & { readings: Record<string, LobeReading> }
  ).readings
  assert.ok(sharp.centre > rough.centre + 30, `sharp ${sharp.centre}, rough ${rough.centre}`)
  const [fx, fy] = flat.brightest,
    [tx, ty] = tilted.brightest
  const [sx, sy] = sharp.brightest
  assert.ok(
    Math.abs(fx - sx) <= 1 && Math.abs(fy - sy) <= 1,
    'a flat coat normal map moves nothing',
  )
  assert.ok(Math.abs(tx - fx) > 3, `the tilted coat moves its highlight along x: ${tx} from ${fx}`)
  assert.ok(Math.abs(ty - fy) <= 1, `and not along y: ${ty} from ${fy}`)
})
