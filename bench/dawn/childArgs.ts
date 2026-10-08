// The command line of a child play of a dissect or an A/B: the run's own options — profile, display,
// features, switches, scale, warm-up, timeout, dirty — carried on, so the child measures what was
// asked; without what makes the run a dissect or an A/B (those are the parent's), the page, the
// scenario, the engine, the plays' count and the report, which the parent names for each child.
import { OPTIONS } from './options.ts'

/** Options that take no value, read from the run's own option table. */
const FLAGS = new Set(
  Object.entries(OPTIONS).flatMap(([name, { type }]) => (type === 'boolean' ? [`--${name}`] : [])),
)
/** Options, with their value, the parent decides for each child. */
const PARENT = new Set([
  '--dissect',
  '--dissect-segment',
  '--rounds',
  '--least',
  '--scenario',
  '--engine',
  '--child-report',
  '--repeat',
])
/** Flags the parent keeps to itself: the machine is measured once, not by every child. */
const ALONE = new Set(['--recalibrate'])

/** `args` (the run's own, page included) less what the parent decides. */
export function childArgs(args: readonly string[]) {
  const kept: string[] = []
  for (let i = 0; i < args.length; i++) {
    const token = args[i]
    const name = token.split('=')[0]
    if (name === '--ab') {
      if (token !== '--ab') throw new Error('BENCH_AB: --ab takes its two checkouts as words')
      i += 2
    } else if (ALONE.has(name)) continue
    else if (PARENT.has(name)) i += token.includes('=') ? 0 : 1
    else if (!token.startsWith('--'))
      continue // the page: the parent gives its file
    else if (FLAGS.has(name) || token.includes('=')) kept.push(token)
    else kept.push(token, args[++i])
  }
  return kept
}
