import { existsSync, readFileSync } from 'node:fs'
import { pathToFileURL } from 'node:url'
import { relatedTests } from './affected-tests.ts'
import {
  changedSteps,
  formatPattern,
  isCodeChange,
  isDocumentation,
  sourcePattern,
} from './changed-steps.ts'
import { documentationTests } from './docs/tests.ts'
import { generateApiFiles } from './generate-api-reference.ts'
import { gitPaths } from './git-paths.ts'
import { heavyStep } from './heavy-lock.ts'
import { pnpmCommand } from './only-pnpm.ts'
import { repositoryFiles } from './repository-files.ts'
import { run } from './run.ts'
import { compileSiteCaches, TEST_SCENES } from './site-caches.ts'
import { changedTypeErrors, tsProjects } from './ts-projects.ts'
import { runUnitTests } from './unit-tests.ts'

// `pnpm run check:changed`, the one local gate: the gates of `validate` on the changed files, and
// the unit tests the change can affect (`scripts/affected-tests.ts`), capped and run one heavy step
// at a time on the machine. The whole `validate` is the CI's. `--push` runs only the gates that
// answer in seconds — no scene caches, tests or Clippy, which wait for other worktrees' heavy steps
// — since git holds the remote's connection open while its pre-push hook runs.

export function existingChangedFiles(changed: Iterable<string>, root = process.cwd()): string[] {
  const maintained = new Set(repositoryFiles(root))
  return [...changed].filter((file) => maintained.has(file))
}

async function main(): Promise<void> {
  const base = process.env.TRILLION3D_BASE_REF ?? 'develop'
  const [diff, untracked, paths] = await Promise.all([
    gitPaths(['diff', '--name-only', '--no-renames', '-z', base, '--']),
    gitPaths(['ls-files', '--others', '--exclude-standard', '-z']),
    gitPaths(['ls-files', '-z']),
  ])
  const changed = new Set([...diff, ...untracked])
  const existing = existingChangedFiles(changed)
  const code = isCodeChange([...changed])
  const files = new Map(
    [...new Set([...paths, ...existing])]
      .filter((file) => code && sourcePattern.test(file) && existsSync(file))
      .map((file): [string, string] => [file, readFileSync(file, 'utf8')]),
  )
  // A documentation change also runs the tests that read documentation (`scripts/docs/tests.ts`).
  const withTests = !process.argv.includes('--push')
  const testFiles = !withTests
    ? []
    : [
        ...new Set([
          ...relatedTests(files, changed),
          ...([...changed].some(isDocumentation) ? documentationTests(paths) : []),
        ]),
      ]
  console.log(`Changed files: ${existing.length}; related tests: ${testFiles.length}`)
  const linted = existing.filter((file) => sourcePattern.test(file))
  for (const step of changedSteps([...changed], existing, testFiles.length))
    switch (step) {
      // The lint and the tests read these untracked files; without a compiler, the caches only warn.
      case 'generate:api':
        await generateApiFiles()
        break
      case 'compile:caches':
        if (withTests) compileSiteCaches(false, TEST_SCENES)
        break
      case 'check:lines':
        run('node', ['scripts/check-file-lines.ts', '--changed'])
        break
      // The two bounds a runtime module answers to instead of the line count, read on the modules
      // this branch touches.
      case 'check:cohesion':
        run('node', ['scripts/check-cohesion.ts', '--changed'])
        break
      case 'format':
        run('node_modules/.bin/prettier', [
          '--check',
          ...existing.filter((file) => formatPattern.test(file)),
        ])
        break
      case 'lint':
        run('node_modules/.bin/eslint', linted)
        break
      case 'types': {
        // `tsc --noEmit` on every project that owns a changed file (#1071).
        const typeErrors = changedTypeErrors(process.cwd(), tsProjects(paths), linted, () =>
          run(...pnpmCommand('run', 'build')),
        )
        if (typeErrors.length) {
          console.error(typeErrors.join('\n'))
          process.exit(1)
        }
        break
      }
      case 'duplicates':
        run('node_modules/.bin/jscpd', [
          ...existing.filter((file) => sourcePattern.test(file) || file.endsWith('.rs')),
          '--format',
          'typescript,javascript,rust',
          '--cross-formats',
          'js-ts',
          '--no-tips',
        ])
        break
      case 'rust':
        if (withTests) heavyStep('clippy', runRust)
        break
      case 'tests':
        runUnitTests(testFiles)
        break
      // `check:x` is `node scripts/check-x.ts`, run directly: `pnpm run` would add a second to each.
      default:
        run('node', [`scripts/${step.replace(':', '-')}.ts`])
    }
  if (!code)
    console.log('Documentation only: no API generation, scene cache or type check; its tests only.')
  else if (!testFiles.length) console.log('No related unit test; the CI runs the whole suite.')
}

function runRust(): void {
  const manifest = ['--manifest-path', 'packages/asset-compiler-rust/Cargo.toml']
  run('cargo', ['fmt', '--all', ...manifest, '--', '--check'])
  run('cargo', [
    'clippy',
    '--release',
    '--locked',
    ...manifest,
    '--all-targets',
    '--all-features',
    '--',
    '-D',
    'warnings',
  ])
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main()
