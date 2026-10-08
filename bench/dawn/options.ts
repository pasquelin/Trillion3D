// What a bench run is asked, from its command line (`run.ts` lists the options).
import { basename } from 'node:path'
import { parseArgs } from 'node:util'
import { engineRoot } from './engineRoot.ts'
import { pageFile } from './page.ts'
import { PROFILES } from './profiles.ts'
import { readScenario } from './scenario.ts'

/** The run's page, scenario, machine profile, display, repeats and address switches. */
/** `--ab A B` is two values: the second goes to `--ab-b`, so it is no page. */
const abArgs = (args: string[]) => {
  const at = args.indexOf('--ab')
  return at < 0
    ? args
    : [...args.slice(0, at), '--ab', args[at + 1], '--ab-b', args[at + 2], ...args.slice(at + 3)]
}

export function benchOptions(args = process.argv.slice(2)) {
  args = abArgs(args)
  const { positionals, values } = parseArgs({
    args,
    allowPositionals: true,
    options: {
      scenario: { type: 'string', default: 'orbit' },
      repeat: { type: 'string', default: '3' },
      switch: { type: 'string', multiple: true, default: [] },
      scale: { type: 'string', default: '0.5' },
      profile: { type: 'string', default: 'desktop' },
      display: { type: 'string' },
      'features-off': { type: 'string', default: '' },
      'cpu-profile': { type: 'boolean', default: false },
      warm: { type: 'string', default: '120' },
      timeout: { type: 'string', default: '600' },
      engine: { type: 'string' },
      dirty: { type: 'boolean', default: false },
      recalibrate: { type: 'boolean', default: false },
      dissect: { type: 'string' },
      ab: { type: 'string' },
      'ab-b': { type: 'string' },
      rounds: { type: 'string', default: '6' },
      least: { type: 'string', default: '0.05' },
      'dissect-segment': { type: 'string' },
      'child-report': { type: 'string' },
    },
  })
  const scenario = readScenario(values.scenario)
  const page = positionals[0] ?? scenario.page
  if (!page || positionals.length > 1)
    throw new Error(
      'usage: node bench/dawn/run.ts <page> [--scenario orbit|drive|still|world|<file>] …',
    )
  const engine = engineRoot(values.engine, values.dirty)
  const file = pageFile(page, engine.root)
  const profile = PROFILES[values.profile]
  if (!profile)
    throw new Error(`BENCH_PROFILE: ${values.profile}; one of ${Object.keys(PROFILES).join(', ')}`)
  const [size, ratio = '1'] = (values.display ?? '').split('@')
  const [width, height] = size.split('x').map(Number)
  return {
    engine,
    file,
    name: basename(file, '.html'),
    scenario,
    repeat: Math.max(1, Number(values.repeat)),
    profileName: values.profile,
    profile,
    display: values.display ? { width, height, ratio: Number(ratio) } : profile.display,
    featuresOff: values['features-off'].split(',').filter(Boolean),
    scale: values.scale,
    cpuProfile: values['cpu-profile'],
    warm: scenario.warm ?? Number(values.warm),
    timeoutS: Number(values.timeout),
    switches: values.switch,
    search: values.switch.length ? `?${values.switch.join('&')}` : '',
    recalibrate: values.recalibrate,
    dirtyOk: values.dirty,
    dissect: values.dissect,
    ab: values.ab && values['ab-b'] ? ([values.ab, values['ab-b']] as [string, string]) : undefined,
    rounds: Math.max(2, Number(values.rounds)),
    least: Number(values.least),
    scenarioArg: values.scenario,
    dissectSegment: values['dissect-segment'],
    childReport: values['child-report'],
  }
}

export type BenchOptions = ReturnType<typeof benchOptions>

/** Now, as a file name's part: an ISO time with no colon or dot. */
export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-')
