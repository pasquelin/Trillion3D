/**
 * The npm release's two steps, as the `Release` workflow runs them:
 *
 *   node scripts/release.ts pack <out> [--publishable]   the six archives, at one version
 *   node scripts/release.ts publish <out> [--publish]    dry-run, then published only if asked;
 *                                                        a package already on npm is skipped
 *
 * Nothing is published without `--publish`, which the workflow passes only on `main` with the
 * repository variable `NPM_PUBLISH` set to `true`; no command here reads or prints a token.
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { Run } from './installed-package/contracts.ts'
import { packRelease, publishRelease } from './release-packages.ts'

const [step, folder] = process.argv.slice(2)
if ((step !== 'pack' && step !== 'publish') || !folder)
  throw new Error('usage: node scripts/release.ts pack|publish <out> [--publishable|--publish]')
const out = resolve(folder)
/** A command whose output is the run's record: npm's list of each archive's files goes to the log. */
const run =
  (inherit: boolean): Run =>
  (command, args, cwd, environment) => {
    const result = spawnSync(command, args, {
      cwd,
      env: environment,
      encoding: 'utf8',
      stdio: inherit ? 'inherit' : 'pipe',
    })
    if (result.error) throw result.error
    if (result.status !== 0)
      throw new Error(`${command} ${args.join(' ')} failed (${result.status})\n${result.stderr}`)
    return result.stdout ?? ''
  }

if (step === 'pack') {
  mkdirSync(out, { recursive: true })
  const release = packRelease({
    root: resolve(import.meta.dirname, '..'),
    out,
    run: run(false),
    pnpm: 'pnpm',
    publishable: process.argv.includes('--publishable'),
  })
  for (const { name, files } of release.archives)
    console.log(`${name}@${release.version}: ${files.length} files`)
} else {
  const publish = process.argv.includes('--publish')
  const release = publishRelease({ out, run: run(true), publish })
  for (const name of release.skipped)
    console.log(`${name}@${release.version}: already on npm, skipped`)
  const count = release.archives.length - release.skipped.length
  console.log(
    `${release.version}: ${publish ? `${count} published` : 'dry run, nothing published'}`,
  )
}
