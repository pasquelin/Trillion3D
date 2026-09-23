// The gates of `pnpm run validate`, in three groups. The CI runs one job per group, in parallel,
// and reports their outcome under a single `validate` check (`.github/workflows/quality.yml`);
// `pnpm run validate` runs the same gates in order, so the local gate and the CI cannot drift.
//
// The groups follow what each gate needs, not what it looks at:
//   quick      the sources alone — it answers in well under a minute, which is when a formatting
//              or a lint mistake should be reported, not after the Rust suite;
//   typescript the `tsc` build and the gates that read its products;
//   native     the Rust crates, and the unit suite, which needs both the compiled compiler
//              (`scripts/docs-fossil-cache.test.ts` skips itself without it) and `dist/`
//              (`tests/integration/extensions-dts.test.ts`). `build` is seven seconds and is
//              repeated here rather than making the job wait on another one.
//
// The CI skips the `*:native` gates when it has restored the binaries built from these exact
// sources by an earlier green run — a decision Cargo cannot make on a fresh clone, where every
// source file is newer than any cached artefact. `build` and `test` stay: the binary is there,
// restored, and the suite that drives it must run.
export const VALIDATE_GROUPS = {
  quick: [
    'check:local',
    'format:check',
    'check:lines',
    'check:duplicates',
    'check:helpers',
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
    'check:tools-types',
  ],
  native: ['lint:native', 'build:native', 'test:native', 'build', 'test'],
} as const satisfies Record<string, readonly string[]>;

export type ValidateGroup = keyof typeof VALIDATE_GROUPS;

/** Whether `name` is one of the three groups, and not a caller's typo. */
export function isValidateGroup(name: string): name is ValidateGroup {
  return Object.hasOwn(VALIDATE_GROUPS, name);
}

/** The ordered gates of a full `validate`: every group's, each one run once. */
export const VALIDATE_STEPS: readonly string[] = [
  ...new Set(Object.values(VALIDATE_GROUPS).flat()),
];

/** The steps that compile the Rust crates: named `*:native` in `package.json`. */
export const NATIVE_STEPS: readonly string[] = VALIDATE_GROUPS.native.filter((step) =>
  step.endsWith(':native'),
);

/** Whether `env` asks `validate` to skip the native steps. */
export function skipsNative(env: NodeJS.ProcessEnv): boolean {
  return env.WEB_GEOMETRY_SKIP_NATIVE === '1';
}

/**
 * The steps `validate` runs under `env`: the named group, or every group, minus the Rust ones when
 * they are skipped. An unknown group name is a caller mistake, and stops the run.
 */
export function stepsToRun(env: NodeJS.ProcessEnv, group?: string): readonly string[] {
  if (group !== undefined && !isValidateGroup(group))
    throw new Error(
      `Unknown validate group '${group}': expected one of ${Object.keys(VALIDATE_GROUPS).join(', ')}.`,
    );
  const steps: readonly string[] = group === undefined ? VALIDATE_STEPS : VALIDATE_GROUPS[group];
  return skipsNative(env) ? steps.filter((step) => !NATIVE_STEPS.includes(step)) : steps;
}
