// `pnpm run test:mutation [--out <dir>] [--mutate <glob>...]`: a measurement, never a gate. Stryker
// mutates the sources of `packages/sdk-core/src`, runs each of its unit test files (the list
// `pnpm test` runs, `isUnitTest`) under `node:test`'s TAP output and reports per test file the mutants
// it kills, and the mutants no test kills. Every covering test file runs against every mutant
// (`disableBail`), so a file killing only mutants another file kills too is still credited.
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { availableParallelism, setPriority } from 'node:os';
import { join, relative, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { Stryker } from '@stryker-mutator/core';
import { mutationMarkdown, summarizeMutation } from './mutation-summary.ts';
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

const stryker = new Stryker({
  testRunner: 'tap',
  plugins: ['@stryker-mutator/tap-runner'],
  tap: { testFiles },
  mutate: values.mutate ?? [`${PACKAGE}**/*.ts`, '!**/*.test.ts', '!**/*.fixture.ts'],
  coverageAnalysis: 'perTest',
  disableBail: true,
  concurrency: Number(process.env.TRILLION3D_MUTATION_CONCURRENCY) || availableParallelism() >> 2,
  reporters: ['json', 'html', 'progress'],
  jsonReporter: { fileName: join(out, 'mutation.json') },
  htmlReporter: { fileName: join(out, 'mutation.html') },
  tempDirName: '.mesure/stryker-tmp',
  cleanTempDir: 'always',
  // A second run retests only the mutants whose source or covering tests changed.
  incremental: true,
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
});

// Hours long, it takes no heavy-step lock (`scripts/heavy-lock.ts`), which would hold every other
// agent's tests that long: a quarter of the cores, at the lowest priority.
setPriority(19);
const results = await stryker.runMutationTest();
const summary = summarizeMutation(
  results.map((mutant) => ({ ...mutant, fileName: relative(root, resolve(mutant.fileName)) })),
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
