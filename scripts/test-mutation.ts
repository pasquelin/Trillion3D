// `pnpm run test:mutation [--out <dir>] [--mutate <glob>...]`: a measurement, never a gate. Stryker
// mutates the sources of `packages/sdk-core/src`, runs its unit test files (the list `pnpm test`
// runs, `isUnitTest`) under `node:test`'s TAP output and reports per test file the mutants it kills,
// and the mutants no test kills. A mutant stops at the first test file that kills it: a file then
// credited with none is run again alone against every mutant it reaches, so a file killing only
// mutants another file killed first is still credited, at a fraction of the cost of running every
// file against every mutant.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, setPriority } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Stryker } from '@stryker-mutator/core';
import { mutationMarkdown, mutationTargets, summarizeMutation } from './mutation-summary.ts';
import { localFileGlobs, repositoryFiles } from './repository-files.ts';
import { isUnitTest } from './unit-tests.ts';

const PACKAGE = 'packages/sdk-core/src/';
const root = resolve(import.meta.dirname, '..');
const { values } = parseArgs({
  options: {
    out: { type: 'string', default: '.mesure/out/mutation' },
    mutate: { type: 'string', multiple: true },
  },
});
const out = resolve(root, values.out!);
const testFiles = (repositoryFiles() ?? []).filter(
  (file) => isUnitTest(file) && file.startsWith(PACKAGE),
);
if (!testFiles.length) throw new Error(`No unit test under ${PACKAGE}.`);
mkdirSync(out, { recursive: true });
// The sandbox is a copy without `.git`: a test reading the index (the Jolt pin of `physics.test.ts`)
// reads this checkout's.
process.env.GIT_DIR = resolve(
  root,
  execFileSync('git', ['rev-parse', '--git-dir'], { cwd: root, encoding: 'utf8' }).trim(),
);

/** One Stryker run of `files`; `full`, every file reaching a mutant runs against it. */
const mutationRun = (files: string[], full: boolean) =>
  new Stryker({
    testRunner: 'tap',
    plugins: ['@stryker-mutator/tap-runner'],
    tap: { testFiles: files },
    mutate: mutationTargets(PACKAGE, values.mutate),
    coverageAnalysis: 'perTest',
    disableBail: full,
    // At least one runner: Stryker starts none at 0 and waits forever (under four cores).
    concurrency:
      Number(process.env.TRILLION3D_MUTATION_CONCURRENCY) ||
      Math.max(1, availableParallelism() >> 2),
    reporters: full ? ['progress'] : ['json', 'html', 'progress'],
    jsonReporter: { fileName: join(out, 'mutation.json') },
    htmlReporter: { fileName: join(out, 'mutation.html') },
    tempDirName: '.mesure/stryker-tmp',
    cleanTempDir: 'always',
    // A second measurement retests only the mutants whose source or covering tests changed.
    incremental: !full,
    incrementalFile: join(out, 'incremental.json'),
    // The sandbox copies the checkout: build products, measurements and native targets stay out.
    ignorePatterns: [
      '/dist',
      '/.mesure',
      '/.worktrees',
      '/graphify-out',
      '**/target',
      '/tests/assets',
      '/site/assets',
      // The personal files, links into the main checkout (`scripts/local-files.ts`).
      ...localFileGlobs(),
    ],
  }).runMutationTest();

// Hours long, it takes no heavy-step lock (`scripts/heavy-lock.ts`), which would hold every other
// agent's tests that long: a quarter of the cores, at the lowest priority.
setPriority(19);
const first = await mutationRun(testFiles, false);
const firstIdle = summarizeMutation(first, testFiles).idle;
const again = firstIdle.length ? await mutationRun(firstIdle, true) : [];
// A mutant is named by its place and change: each run numbers its own.
const key = (m: (typeof first)[number]) =>
  `${m.fileName}:${m.location.start.line}:${m.location.start.column}:${m.mutatorName}:${m.replacement}`;
const killers = new Map(again.map((mutant) => [key(mutant), mutant.killedBy ?? []]));
const summary = summarizeMutation(
  first.map((mutant) => ({
    ...mutant,
    fileName: relative(root, resolve(mutant.fileName)),
    killedBy: [...(mutant.killedBy ?? []), ...(killers.get(key(mutant)) ?? [])],
  })),
  testFiles,
);
const detail = summary.survivors.flatMap(({ file, mutants }) => [
  `## ${file}`,
  ...mutants.map(
    (m) =>
      `- ${m.location?.start.line} ${m.mutatorName} ${m.status}: ${m.replacement?.split('\n')[0]}`,
  ),
]);
const kills = [...summary.kills].map(([file, count]) => `${count}\t${file}`);
writeFileSync(join(out, 'summary.md'), mutationMarkdown(summary));
writeFileSync(join(out, 'survivors.md'), `${detail.join('\n')}\n`);
writeFileSync(join(out, 'kills.tsv'), `${kills.join('\n')}\n`);
process.stdout.write(`${mutationMarkdown(summary)}\nReports: ${relative(root, out)}/\n`);
