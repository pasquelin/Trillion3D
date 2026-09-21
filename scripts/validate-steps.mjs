// The gates of `pnpm run validate`, in three groups that depend on nothing of each other. The CI
// runs one job per group, in parallel, and reports their outcome under a single `validate` check
// (`.github/workflows/quality.yml`); `pnpm run validate` runs the same groups in order, so the
// local gate and the CI cannot drift apart.
//
// `quick` holds every gate that reads the sources alone: it answers in well under a minute, which
// is when a formatting or lint mistake should be reported. `typescript` builds before the gates
// that read the build products. `native` compiles the Rust crates; the CI skips it when it has
// restored the binaries built from these exact sources by an earlier green run, a decision Cargo
// cannot make on a fresh clone where every source file is newer than any cached artefact.
export const VALIDATE_GROUPS = {
  quick: [
    'check:local',
    'format:check',
    'check:lines',
    'check:duplicates',
    'lint:js',
    'check:unused',
    'check:no-js',
    'check:links',
  ],
  typescript: [
    'build',
    'check:dts',
    'check:structure',
    'check:docs-bundles',
    'check:site-types',
    'test',
  ],
  native: ['lint:native', 'build:native', 'test:native'],
};

/** The ordered gates of a full `validate`. */
export const VALIDATE_STEPS = Object.values(VALIDATE_GROUPS).flat();

/** The steps that compile the Rust crates. */
export const NATIVE_STEPS = VALIDATE_GROUPS.native;

/** Whether `env` asks `validate` to skip the native steps. */
export function skipsNative(env) {
  return env.WEB_GEOMETRY_SKIP_NATIVE === '1';
}

/**
 * The steps `validate` runs: the named group, or every group, minus the native ones when they are
 * skipped. An unknown group name is a caller mistake, and stops the run.
 */
export function stepsToRun(env, group) {
  if (group && !Object.hasOwn(VALIDATE_GROUPS, group))
    throw new Error(
      `Unknown validate group '${group}': expected one of ${Object.keys(VALIDATE_GROUPS).join(', ')}.`,
    );
  const steps = group ? VALIDATE_GROUPS[group] : VALIDATE_STEPS;
  return skipsNative(env) ? steps.filter((step) => !NATIVE_STEPS.includes(step)) : steps;
}
