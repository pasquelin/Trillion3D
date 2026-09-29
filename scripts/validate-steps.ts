// The gates of `pnpm run validate`, in four groups. The CI runs one job per group, in parallel (the
// unit group once per shard of the suite), and reports their outcome under a single `validate`
// check (`.github/workflows/quality.yml`); `pnpm run validate` runs the same gates in order, so the
// local gate and the CI cannot drift.
//
// The groups follow what each gate needs, not what it looks at:
//   quick      the sources alone — it answers in well under a minute, which is when a formatting
//              or a lint mistake should be reported, not after the Rust suite;
//   typescript the `tsc` build, the site build (`build:docs`) and the gates that read their
//              products;
//   native     Clippy and the Rust tests, which read the scene caches the compiled compiler cooks
//              (`committed_colliders_hold_their_published_tolerance`);
//   unit       the unit suite, which needs both the compiled compiler
//              (`tests/integration/shared-cache-format.test.ts` skips part of itself without it)
//              and `dist/` (`tests/integration/extensions-dts.test.ts`). `build` is seven seconds and is
//              repeated here rather than making the job wait on another one; `test` cooks the
//              scene caches itself (`scripts/test-unit.ts`). The CI splits the suite by
//              `TRILLION3D_TEST_SHARD` (`scripts/unit-tests.ts`).
//
// The CI skips the `*:native` gates when it has restored the binaries built from these exact
// sources by an earlier green run — a decision Cargo cannot make on a fresh clone, where every
// source file is newer than any cached artefact. `build` and `test` stay: the binary is there,
// restored, and the suite that drives it must run.
/** The fast gates that read the whole tree, which `check:changed` runs too: each `check:x` is
 *  `node scripts/check-x.ts`. */
export const TREE_GATES = ['check:translations', 'check:english'] as const;

export const VALIDATE_GROUPS = {
  quick: [
    'generate:api',
    'check:local',
    'format:check',
    'check:lines',
    'check:duplicates',
    'check:helpers',
    'lint:js',
    'check:unused',
    'check:no-js',
    'check:links',
    'check:docs-three',
    'check:sdk-facade',
    'check:i18n',
    ...TREE_GATES,
  ],
  typescript: [
    'generate:api',
    'build',
    'check:dts',
    'check:structure',
    'check:docs-bundles',
    'build:docs',
    'check:site-types',
    'check:tools-types',
  ],
  native: ['lint:native', 'build:native', 'compile:caches', 'test:native'],
  unit: ['build:native', 'build', 'test'],
} as const satisfies Record<string, readonly string[]>;

type ValidateGroup = keyof typeof VALIDATE_GROUPS;

/** Whether `name` is one of the groups, and not a caller's typo. */
function isValidateGroup(name: string): name is ValidateGroup {
  return Object.hasOwn(VALIDATE_GROUPS, name);
}

/** The ordered gates of a full `validate`: every group's, each one run once. */
export const VALIDATE_STEPS: readonly string[] = [
  ...new Set(Object.values(VALIDATE_GROUPS).flat()),
];

/** The steps that compile the Rust crates: named `*:native` in `package.json`. */
export const NATIVE_STEPS: readonly string[] = VALIDATE_STEPS.filter((step) =>
  step.endsWith(':native'),
);

/** Whether `env` asks `validate` to skip the native steps. */
export function skipsNative(env: NodeJS.ProcessEnv): boolean {
  return env.TRILLION3D_SKIP_NATIVE === '1';
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
