// What anisotropic filtering costs the WebGPU engine (#360, #361): one floor with detail at every
// texel, seen at a grazing angle, drawn at each anisotropy asked — 1 and 16 by default — by the
// engine's sources on Dawn in this process (`tests/gpu/kit/onDawn.ts`), under the machine's bench
// lock, and the p50 GPU time of its images printed side by side. The page is
// `tests/gpu/texture/anisotropyCostPage.ts`; nothing outside this repository is read.
//
//   node bench/runner/counts/anisotropyCost.ts [--anisotropy 1,16] [--images 240]
//        [--width 1920] [--height 1080]
import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { parseArgs } from '../harness/options.ts'
import { takeBenchLock } from '../../dawn/lock.ts'
import { loadPage, runOnDawn } from '../../../tests/gpu/kit/onDawn.ts'
import type { run } from '../../../tests/gpu/texture/anisotropyCostPage.ts'

declare global {
  var anisotropyCost: { run: typeof run }
}

/** The fixture's options, read from the command line and checked. */
export function anisotropyOptions(argv: string[]) {
  const flags = parseArgs(argv)
  const count = (name: string, fallback: number) => {
    const value = Number(flags.get(name) ?? fallback)
    assert.ok(Number.isInteger(value) && value > 0, `--${name} must be a positive integer`)
    return value
  }
  const anisotropies = (flags.get('anisotropy') ?? '1,16').split(',').map(Number)
  assert.ok(
    anisotropies.every((value) => Number.isInteger(value) && value >= 1 && value <= 16),
    '--anisotropy takes integers from 1 to 16',
  )
  return {
    anisotropies,
    size: [count('width', 1920), count('height', 1080)] as [number, number],
    frames: count('images', 240),
  }
}

async function main() {
  const options = anisotropyOptions(process.argv.slice(2))
  takeBenchLock('anisotropy cost')
  await loadPage(
    resolve(import.meta.dirname, '../../../tests/gpu/texture/anisotropyCostPage.ts'),
    'anisotropyCost',
  )
  const result = await runOnDawn((input) => globalThis.anisotropyCost.run(input), options)
  console.log(`GPU: ${result.gpu}; per-pass timestamps: ${result.timed ? 'yes' : 'no'}`)
  console.table(
    result.readings.map(({ anisotropy, frameMs, passesMs, samples }) => ({
      anisotropy,
      'image p50 (ms)': frameMs?.toFixed(3) ?? 'unmeasured',
      'passes p50 (ms)': passesMs?.toFixed(3) ?? 'unmeasured',
      samples,
    })),
  )
}

if (import.meta.main) await main()
