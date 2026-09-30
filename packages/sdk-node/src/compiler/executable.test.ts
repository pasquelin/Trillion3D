import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentCompilerExecutable } from './executable.mts';
import { COMPILER_PLATFORMS } from './platform.mts';

/** An installed package: the crate folder beside it carries no `Cargo.toml`. */
async function installed(run: (crate: string) => void) {
  const crate = await mkdtemp(join(tmpdir(), 'trillion3d-installed-'));
  try {
    run(join(crate, 'packages/asset-compiler-rust'));
  } finally {
    await rm(crate, { recursive: true, force: true });
  }
}

// Behaviour: an installed package with no compiler program tells the user what to do — reinstall,
// or name a program with `TRILLION3D_COMPILER_BIN` — and names no path of this repository.
test('a missing compiler in an installed package gives the actions and no repository path', () =>
  installed((crate) =>
    assert.throws(
      () =>
        currentCompilerExecutable(
          undefined,
          {},
          { crate, platform: 'linux', arch: 'x64', installed: null },
        ),
      (error: Error) =>
        /^T3D-E\d{3} COMPILER_EXECUTABLE_MISSING: /.test(error.message) &&
        error.message.includes('Reinstall') &&
        error.message.includes('TRILLION3D_COMPILER_BIN') &&
        !error.message.includes('packages/') &&
        !error.message.includes('build:native') &&
        !error.message.includes('COMPILER_STALE'),
    ),
  ));

// Behaviour: a machine the compiler is not built for is named, with the supported list.
test('an unsupported platform is told the supported list', () =>
  installed((crate) =>
    assert.throws(
      () => currentCompilerExecutable(undefined, {}, { crate, platform: 'aix', arch: 'ppc64' }),
      (error: Error) =>
        error.message.includes('COMPILER_PLATFORM_UNSUPPORTED') &&
        error.message.includes('aix-ppc64') &&
        COMPILER_PLATFORMS.every((machine) => error.message.includes(machine)) &&
        !error.message.includes('packages/'),
    ),
  ));
