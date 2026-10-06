import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { currentCompilerExecutable } from './executable.mts'
import { COMPILER_PLATFORMS, compilerPackage, installedCompiler } from './platform.mts'

const ROOT = new URL('../../../../', import.meta.url)
const readJson = async (path: string) =>
  JSON.parse(await readFile(new URL(path, ROOT), 'utf8')) as Record<string, unknown>

// Behaviour: an application that installed `trillion3d` finds the compiler of its platform package,
// with no TRILLION3D_COMPILER_BIN and no checkout beside it.
test('the installed platform package is the compiler, without TRILLION3D_COMPILER_BIN', async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'trillion3d-platform-')))
  const from = pathToFileURL(join(fixture, 'app.mjs'))
  const installed = join(fixture, 'node_modules/@trillion3d/compiler-linux-x64')
  const binary = join(installed, 'bin/trillion3d-compiler')
  try {
    await mkdir(join(installed, 'bin'), { recursive: true })
    await writeFile(join(installed, 'package.json'), '{"name":"@trillion3d/compiler-linux-x64"}')
    assert.equal(installedCompiler('linux', 'x64', from), null, 'a package without its binary')
    await writeFile(binary, '')
    const found = installedCompiler('linux', 'x64', from)
    assert.equal(found, binary)
    assert.equal(installedCompiler('linux', 'arm64', from), null, 'another platform, not installed')
    assert.equal(
      currentCompilerExecutable(
        undefined,
        {},
        { crate: join(fixture, 'no-crate'), installed: found },
      ),
      binary,
    )
    assert.throws(
      () =>
        currentCompilerExecutable(
          undefined,
          {},
          { crate: join(fixture, 'no-crate'), platform: 'linux', arch: 'x64', installed: null },
        ),
      /^Error: T3D-E\d{3} COMPILER_EXECUTABLE_MISSING: .*\(@trillion3d\/compiler-linux-x64 /,
      'no package, no checkout: the package to install is named',
    )
    const named = { TRILLION3D_COMPILER_BIN: '/operator/compiler' }
    assert.equal(
      currentCompilerExecutable(undefined, named, { installed: null }),
      '/operator/compiler',
    )
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

// Behaviour: in this checkout the platform package is a workspace link to `packages/compiler/`, not
// an install: a binary copied there does not pass the checkout's own build.
test('a workspace link to the platform package is not an installed compiler', async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'trillion3d-workspace-')))
  const from = pathToFileURL(join(fixture, 'app.mjs'))
  const source = join(fixture, 'packages/compiler/linux-x64')
  try {
    await mkdir(join(source, 'bin'), { recursive: true })
    await writeFile(join(source, 'package.json'), '{"name":"@trillion3d/compiler-linux-x64"}')
    await writeFile(join(source, 'bin/trillion3d-compiler'), '')
    await mkdir(join(fixture, 'node_modules/@trillion3d'), { recursive: true })
    await symlink(source, join(fixture, 'node_modules/@trillion3d/compiler-linux-x64'), 'dir')
    assert.equal(installedCompiler('linux', 'x64', from), null)
  } finally {
    await rm(fixture, { recursive: true, force: true })
  }
})

// Behaviour: only the five built platforms have a compiler package (the refusal: executable.test.ts).
test('only a platform a compiler is built for has a package', () => {
  assert.equal(compilerPackage('linux', 'ia32'), null)
  assert.equal(compilerPackage('win32', 'x64'), '@trillion3d/compiler-win32-x64')
  assert.equal(compilerPackage('freebsd', 'x64'), null)
})

// Behaviour: `trillion3d` declares each platform package as optional, at its own version, and each
// package names the one platform npm installs it on.
test('each built platform is an optional package of trillion3d, at its version', async () => {
  const root = await readJson('package.json')
  const optional = root.optionalDependencies as Record<string, string>
  assert.deepEqual(
    Object.keys(optional).sort(),
    COMPILER_PLATFORMS.map((target) => `@trillion3d/compiler-${target}`).sort(),
  )
  for (const target of COMPILER_PLATFORMS) {
    const manifest = await readJson(`packages/compiler/${target}/package.json`)
    const [os, cpu] = target.split('-')
    assert.equal(manifest.name, compilerPackage(os, cpu))
    assert.equal(manifest.version, root.version, target)
    assert.equal(manifest.private, root.private, target)
    assert.equal(manifest.license, root.license, target)
    assert.deepEqual([manifest.os, manifest.cpu], [[os], [cpu]])
  }
})
