import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { currentCompilerExecutable, resolveCompilerExecutable } from './process.mts';
import {
  COMPILER_PLATFORMS,
  compilerPackage,
  installedCompiler,
  requireSupportedPlatform,
} from './platform.mts';

const ROOT = new URL('../../../../', import.meta.url);
const readJson = async (path: string) =>
  JSON.parse(await readFile(new URL(path, ROOT), 'utf8')) as Record<string, unknown>;

// Behaviour: an application that installed `trillion3d` finds the compiler of its platform package,
// with no TRILLION3D_COMPILER_BIN and no checkout beside it (#1352).
test('the installed platform package is the compiler, without TRILLION3D_COMPILER_BIN', async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'trillion3d-platform-')));
  const from = pathToFileURL(join(fixture, 'app.mjs'));
  const installed = join(fixture, 'node_modules/@trillion3d/compiler-linux-x64');
  const binary = join(installed, 'bin/trillion3d-compiler');
  try {
    await mkdir(join(installed, 'bin'), { recursive: true });
    await writeFile(join(installed, 'package.json'), '{"name":"@trillion3d/compiler-linux-x64"}');
    assert.equal(installedCompiler('linux', 'x64', from), null, 'a package without its binary');
    await writeFile(binary, '');
    const found = installedCompiler('linux', 'x64', from);
    assert.equal(found, binary);
    assert.equal(
      installedCompiler('linux', 'arm64', from),
      null,
      'another platform, not installed',
    );
    assert.equal(resolveCompilerExecutable(undefined, {}, 'linux', found), binary);
    assert.equal(
      currentCompilerExecutable(undefined, {}, join(fixture, 'no-crate'), found),
      binary,
    );
    assert.throws(
      () => currentCompilerExecutable(undefined, {}, join(fixture, 'no-crate'), null),
      /^Error: COMPILER_(EXECUTABLE_MISSING: @trillion3d\/compiler-|PLATFORM_UNSUPPORTED: )/,
      'no package, no checkout: the package to install is named',
    );
    const named = { TRILLION3D_COMPILER_BIN: '/operator/compiler' };
    assert.equal(resolveCompilerExecutable(undefined, named, 'linux', null), '/operator/compiler');
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

// Behaviour: in this checkout the platform package is a workspace link to `packages/compiler/`, not
// an install: a binary copied there does not pass the checkout's own build (#1352).
test('a workspace link to the platform package is not an installed compiler', async () => {
  const fixture = await realpath(await mkdtemp(join(tmpdir(), 'trillion3d-workspace-')));
  const from = pathToFileURL(join(fixture, 'app.mjs'));
  const source = join(fixture, 'packages/compiler/linux-x64');
  try {
    await mkdir(join(source, 'bin'), { recursive: true });
    await writeFile(join(source, 'package.json'), '{"name":"@trillion3d/compiler-linux-x64"}');
    await writeFile(join(source, 'bin/trillion3d-compiler'), '');
    await mkdir(join(fixture, 'node_modules/@trillion3d'), { recursive: true });
    await symlink(source, join(fixture, 'node_modules/@trillion3d/compiler-linux-x64'), 'dir');
    assert.equal(installedCompiler('linux', 'x64', from), null);
  } finally {
    await rm(fixture, { recursive: true, force: true });
  }
});

// Behaviour: a platform no compiler is built for is refused by its code, with the supported list.
test('an unsupported platform is refused with the platforms a compiler is built for', () => {
  assert.equal(compilerPackage('linux', 'ia32'), null);
  assert.equal(compilerPackage('win32', 'x64'), '@trillion3d/compiler-win32-x64');
  assert.throws(
    () => requireSupportedPlatform('freebsd', 'x64'),
    (error: Error) =>
      error.message.startsWith('COMPILER_PLATFORM_UNSUPPORTED: ') &&
      error.message.includes('freebsd-x64') &&
      COMPILER_PLATFORMS.every((platform) => error.message.includes(platform)),
  );
  assert.doesNotThrow(() => requireSupportedPlatform('darwin', 'arm64'));
});

// Behaviour: `trillion3d` declares each platform package as optional, at its own version, and each
// package names the one platform npm installs it on.
test('each built platform is an optional package of trillion3d, at its version', async () => {
  const root = await readJson('package.json');
  const optional = root.optionalDependencies as Record<string, string>;
  assert.deepEqual(
    Object.keys(optional).sort(),
    COMPILER_PLATFORMS.map((target) => `@trillion3d/compiler-${target}`).sort(),
  );
  for (const target of COMPILER_PLATFORMS) {
    const manifest = await readJson(`packages/compiler/${target}/package.json`);
    const [os, cpu] = target.split('-');
    assert.equal(manifest.name, compilerPackage(os, cpu));
    assert.equal(manifest.version, root.version, target);
    assert.equal(manifest.private, root.private, target);
    assert.equal(manifest.license, root.license, target);
    assert.deepEqual([manifest.os, manifest.cpu], [[os], [cpu]]);
  }
});
