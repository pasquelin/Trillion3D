import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { COMPILER_PLATFORMS } from '../packages/sdk-node/src/compiler/platform.mts'
import type { Run } from './installed-package/contracts.ts'
import { packRelease, publishRelease, readRelease, releaseNames } from './release-packages.ts'

/** A checkout as the pack job holds it: six manifests at `version`, each compiler downloaded
 *  without its execute bit, `skip` left out. */
function checkout(version = '1.0.0', skip = '') {
  const root = mkdtempSync(join(tmpdir(), 'trillion3d-release-'))
  const manifest = (folder: string, name: string) => {
    mkdirSync(folder, { recursive: true })
    writeFileSync(join(folder, 'package.json'), JSON.stringify({ name, version, private: true }))
  }
  manifest(root, 'trillion3d')
  for (const platform of COMPILER_PLATFORMS) {
    const folder = join(root, 'packages/compiler', platform)
    manifest(folder, `@trillion3d/compiler-${platform}`)
    if (platform === skip) continue
    mkdirSync(join(folder, 'bin'))
    const file = `trillion3d-compiler${platform.startsWith('win32') ? '.exe' : ''}`
    writeFileSync(join(folder, 'bin', file), '', { mode: 0o644 })
  }
  const out = join(root, 'out')
  mkdirSync(out)
  return { root, out }
}

/** `pnpm pack` as the release calls it: the archive written, the manifest it packed recorded. */
function fakePack(extra: string[] = []) {
  const packed: Record<string, { private?: boolean }> = {}
  const packers: Record<string, string> = {}
  const run: Run = (command, args, cwd = '') => {
    const manifest = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8'))
    packers[manifest.name] = command
    const filename = join(args[args.length - 1], `${manifest.name.replace(/\W/g, '-')}.tgz`)
    writeFileSync(filename, '')
    packed[manifest.name] = manifest
    const bin = cwd.includes('packages') ? ['bin/trillion3d-compiler'] : ['dist/sdk/index.js']
    return JSON.stringify({ filename, files: [...bin, ...extra].map((path) => ({ path })) })
  }
  return { run, packed, packers }
}

// Behaviour: the six packages go out at one version, or not at all (#1354).
test('the pack refuses a package at another version', () => {
  const { root, out } = checkout()
  const path = join(root, 'packages/compiler/win32-x64/package.json')
  writeFileSync(path, JSON.stringify({ name: '@trillion3d/compiler-win32-x64', version: '0.9.0' }))
  assert.throws(
    () => packRelease({ root, out, run: fakePack().run, pnpm: 'pnpm', publishable: false }),
    /@trillion3d\/compiler-win32-x64 0\.9\.0/,
  )
  rmSync(root, { recursive: true })
})

// Behaviour: a platform's compiler missing stops the release before anything is packed.
test('the pack refuses a missing compiler and packs nothing', () => {
  const { root, out } = checkout('1.0.0', 'darwin-x64')
  const { run, packed } = fakePack()
  assert.throws(
    () => packRelease({ root, out, run, pnpm: 'pnpm', publishable: false }),
    /compiler missing: .*darwin-x64/,
  )
  assert.deepEqual(packed, {})
  rmSync(root, { recursive: true })
})

// Behaviour: the downloaded compilers are executable again and packed by npm, which keeps the
// execute bit pnpm drops; the archives recorded in publication order, and `private` kept unless
// the release is packed publishable — the checkout keeps it.
test('the pack restores the execute bit and removes private only when asked', () => {
  for (const publishable of [false, true]) {
    const { root, out } = checkout()
    const { run, packed, packers } = fakePack()
    const release = packRelease({ root, out, run, pnpm: 'pnpm', publishable })
    const binary = join(root, 'packages/compiler/linux-x64/bin/trillion3d-compiler')
    assert.equal(statSync(binary).mode & 0o111, 0o111)
    assert.deepEqual(
      release.archives.map((archive) => archive.name),
      releaseNames(),
    )
    assert.deepEqual(
      releaseNames().map((name) => packers[name]),
      [...Array(5).fill('npm'), 'pnpm'],
    )
    assert.equal(packed.trillion3d.private, publishable ? undefined : true)
    assert.equal(JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).private, true)
    assert.equal(readRelease(out).publishable, publishable)
    rmSync(root, { recursive: true })
  }
})

// Behaviour: the package never carries the documentation site nor the witnesses.
test('the pack refuses an archive that carries the site', () => {
  const { root, out } = checkout()
  assert.throws(
    () =>
      packRelease({
        root,
        out,
        run: fakePack(['dist/site/index.html']).run,
        pnpm: 'pnpm',
        publishable: false,
      }),
    /carries dist\/site\/index\.html/,
  )
  rmSync(root, { recursive: true })
})

/** A packed release and the npm commands its publication runs. */
function packed(publishable: boolean) {
  const { root, out } = checkout()
  packRelease({ root, out, run: fakePack().run, pnpm: 'pnpm', publishable })
  const commands: string[] = []
  const run: Run = (command, args) => {
    commands.push([command, ...args.map((arg) => arg.replace(`${out}/`, ''))].join(' '))
    return ''
  }
  return { root, out, run, commands }
}

// Behaviour: every publication is dry-run first, the compilers before `trillion3d`; the real one
// only when asked, of a release packed publishable.
test('the publication dry-runs the six, then publishes them only when asked', () => {
  const dry = packed(false)
  publishRelease({ out: dry.out, run: dry.run, publish: false, published: () => false })
  assert.equal(dry.commands.length, 6)
  assert.ok(dry.commands.every((command) => command.endsWith('--dry-run')))
  assert.match(dry.commands[5], /^npm publish trillion3d\.tgz/)
  assert.throws(
    () => publishRelease({ out: dry.out, run: dry.run, publish: true, published: () => false }),
    /packed private/,
  )
  const real = packed(true)
  publishRelease({ out: real.out, run: real.run, publish: true, published: () => false })
  assert.deepEqual(
    real.commands.slice(6),
    real.commands.slice(0, 6).map((c) => c.replace(' --dry-run', '')),
  )
  for (const { root } of [dry, real]) rmSync(root, { recursive: true })
})

// Behaviour: a package already on npm at this version is skipped, so that a rerun of a publication
// stopped halfway publishes the rest in order; an archive missing stops it before any npm command.
test('the publication skips a version already published and refuses a missing archive', () => {
  const release = packed(true)
  const done = new Set(
    releaseNames()
      .slice(0, 2)
      .map((name) => `${name}@1.0.0`),
  )
  const result = publishRelease({
    out: release.out,
    run: release.run,
    publish: true,
    published: (spec) => done.has(spec),
  })
  assert.deepEqual(result.skipped, releaseNames().slice(0, 2))
  const rest = releaseNames()
    .slice(2)
    .map((name) => `npm publish ${name.replace(/\W/g, '-')}.tgz`)
  assert.deepEqual(release.commands, [...rest.map((c) => `${c} --dry-run`), ...rest])
  release.commands.length = 0
  rmSync(join(release.out, 'trillion3d.tgz'))
  assert.throws(
    () =>
      publishRelease({
        out: release.out,
        run: release.run,
        publish: false,
        published: () => false,
      }),
    /archive missing/,
  )
  assert.deepEqual(release.commands, [])
  rmSync(release.root, { recursive: true })
})
