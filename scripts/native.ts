// The cargo commands of every crate of `native-crates.ts`, in its order, each with the crate's
// flags; the first failure stops the run. `node scripts/native.ts test|lint|fmt|fmt-check|golden`
// (`pnpm run test:native`, `lint:native`, `format`, `format:check`, `golden:write`), and
// `golden-check`, which `check-changed.ts` runs; crate folders named after the command run those
// crates alone.
import { spawnSync } from 'node:child_process'
import { NATIVE_CRATES, type NativeCrate } from './native-crates.ts'

const features = (crate: NativeCrate) => (crate.allFeatures ? ['--all-features'] : [])
const manifest = (crate: NativeCrate) => ['--manifest-path', `${crate.path}/Cargo.toml`]
const test = (crate: NativeCrate) => [
  'test',
  '--release',
  '--locked',
  ...features(crate),
  ...manifest(crate),
]

const COMMANDS: Record<string, (crate: NativeCrate) => string[]> = {
  test,
  lint: (crate) => [
    'clippy',
    '--release',
    '--locked',
    ...manifest(crate),
    '--all-targets',
    ...features(crate),
    '--',
    '-D',
    'warnings',
  ],
  fmt: (crate) => ['fmt', '--all', ...manifest(crate)],
  'fmt-check': (crate) => ['fmt', '--all', ...manifest(crate), '--', '--check'],
  // Each crate's golden test, writing its files (`packages/math/rust/src/golden.rs`) or, as
  // `golden-check`, held to them.
  golden: (crate) => [...test(crate), 'golden_twins'],
  'golden-check': (crate) => [...test(crate), 'golden_twins'],
}

const name = process.argv[2] ?? ''
const command = COMMANDS[name]
if (!command) {
  console.error(`native: one of ${Object.keys(COMMANDS).join(', ')}`)
  process.exit(2)
}
const env = name === 'golden' ? { ...process.env, GOLDEN_WRITE: '1' } : process.env
const named = NATIVE_CRATES.filter((crate) => process.argv.slice(3).includes(crate.path))
for (const crate of named.length ? named : NATIVE_CRATES) {
  const done = spawnSync('cargo', command(crate), { stdio: 'inherit', env })
  if (done.status !== 0) process.exit(done.status ?? 1)
}
