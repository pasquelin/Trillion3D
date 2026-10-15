// Telemetry: frame intervals, against its oracle. The hexadecimal digest left
// this bench: `toHex` has no engine caller (`sha256Hex` writes its own loop).
import { frameStatistics } from '../../../packages/sdk-core/src/runtime/stats.ts'
import { UNMEASURED } from '../../../packages/sdk-browser/src/world/diagnostic/metrics.ts'
import { EngineProfiler } from '../../../packages/sdk-browser/src/diagnostic/telemetry.ts'
import { measure } from '../../core/measure.ts'
import { rapport } from '../../core/report.ts'
import { xorshiftRandom } from '../../../packages/math/src/sequence/random.ts'
import { referenceIntervals } from '../../oracles/browser/telemetry.ts'

const alea = xorshiftRandom(83)
const intervalles: number[] = []
for (let i = 0; i < 2000; i++) intervalles.push(8 + alea() * 12)
const resTelemetry = await measure({
  name: 'frame intervals',
  fichier: 'packages/sdk-browser/src/diagnostic/telemetry.ts',
  cas: [
    { name: '2 000 frames', input: intervalles, size: 2000 },
    { name: 'no frames', input: [], size: 0 },
  ],
  calculation: (valeurs: number[]) => {
    const profile = new EngineProfiler(120)
    // `record()` files the display interval the refresh clock measured, on the unmeasured sample.
    for (const dt of valeurs) profile.record({ ...UNMEASURED, rafIntervalMs: dt })
    return frameStatistics(profile.orderedIntervals())
  },
  expected: (valeurs: number[]) => frameStatistics(referenceIntervals(120, valeurs)),
  options: { tours: 100, budgetMs: 1500 },
})

rapport('telemetrie', [resTelemetry], 'A14 yields the exact same values')
