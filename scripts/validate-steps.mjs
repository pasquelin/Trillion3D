// The ordered gates of `pnpm run validate`, and which of them a given environment runs.
//
// The native steps compile the Rust crates. The CI skips them when it has restored the binaries
// built from these exact sources by an earlier green run (`.github/workflows/quality.yml`); Cargo
// cannot make that decision itself on a fresh clone, where every source file is newer than any
// cached artefact. Locally the variable is never set and the gate stays complete.
export const VALIDATE_STEPS = [
  'check:local',
  'format:check',
  'check:lines',
  'check:duplicates',
  'lint:js',
  'lint:native',
  'check:unused',
  'build',
  'build:native',
  'check:structure',
  'check:dts',
  'check:docs-demo',
  'check:links',
  'test',
  'test:native',
];

export const NATIVE_STEPS = new Set(['lint:native', 'build:native', 'test:native']);

/** The steps `validate` runs under `env`: every step, minus the native ones when they are skipped. */
export function stepsToRun(env) {
  const skipNative = env.WEB_GEOMETRY_SKIP_NATIVE === '1';
  return VALIDATE_STEPS.filter((step) => !(skipNative && NATIVE_STEPS.has(step)));
}
