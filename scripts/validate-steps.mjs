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
  'check:no-js',
  'check:docs-bundles',
  'check:site-types',
  'check:links',
  'test',
  'test:native',
];

/** The steps that compile the Rust crates: named `*:native` in `package.json`. */
export const NATIVE_STEPS = VALIDATE_STEPS.filter((step) => step.endsWith(':native'));

/** Whether `env` asks `validate` to skip the native steps. */
export function skipsNative(env) {
  return env.WEB_GEOMETRY_SKIP_NATIVE === '1';
}

/** The steps `validate` runs under `env`: every step, minus the native ones when they are skipped. */
export function stepsToRun(env) {
  return skipsNative(env)
    ? VALIDATE_STEPS.filter((step) => !NATIVE_STEPS.includes(step))
    : VALIDATE_STEPS;
}
