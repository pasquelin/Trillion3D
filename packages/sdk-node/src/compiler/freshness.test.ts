import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { currentCompilerExecutable } from './process.mts';
import { sourceNewerThan } from './freshness.mts';

const binaryName = `trillion3d-compiler${process.platform === 'win32' ? '.exe' : ''}`;

/** A crate built at `builtAt` from sources dated `editedAt`: seconds since the epoch. */
async function crate(builtAt: number, editedAt: number) {
  const root = await mkdtemp(join(tmpdir(), 'trillion3d-freshness-'));
  await mkdir(join(root, 'src/nested'), { recursive: true });
  await mkdir(join(root, 'target/release'), { recursive: true });
  const binary = join(root, 'target/release', binaryName);
  const sources = ['Cargo.toml', 'src/lib.rs', 'src/nested/stage.rs'].map((file) =>
    join(root, file),
  );
  for (const file of sources) {
    await writeFile(file, '');
    await utimes(file, editedAt, editedAt);
  }
  await writeFile(binary, '');
  await utimes(binary, builtAt, builtAt);
  return { root, binary, stage: sources[2] };
}

// Behaviour: the checkout's build is launched as long as nothing it is built from moved since.
test('a compiler built after its sources is the one a cook runs', async () => {
  const { root, binary } = await crate(2_000, 1_000);
  try {
    assert.equal(currentCompilerExecutable(undefined, {}, root), binary);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Behaviour: a crate source edited after the build refuses the cook by name, with the file and
// the command that rebuilds — never a product under the previous build's key (#291).
test('editing a crate source refuses the cook until the compiler is rebuilt', async () => {
  const { root, binary, stage } = await crate(2_000, 1_000);
  try {
    await utimes(stage, 3_000, 3_000);
    assert.throws(
      () => currentCompilerExecutable(undefined, {}, root),
      (error: Error) =>
        error.message.startsWith(`COMPILER_STALE: ${binary} is older than ${stage}`) &&
        error.message.includes('pnpm run build:native'),
    );
    await utimes(binary, 4_000, 4_000);
    assert.equal(currentCompilerExecutable(undefined, {}, root), binary);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Behaviour: a binary the operator names is trusted whatever the crate says, and announced once.
test('a binary named by TRILLION3D_COMPILER_BIN is trusted and announced once', async (t) => {
  const { root } = await crate(1_000, 2_000);
  const written: unknown[] = [];
  t.mock.method(process.stderr, 'write', (chunk: unknown) => written.push(chunk) > 0);
  try {
    const environment = { TRILLION3D_COMPILER_BIN: '/operator/compiler' };
    assert.equal(currentCompilerExecutable(undefined, environment, root), '/operator/compiler');
    assert.equal(currentCompilerExecutable(undefined, environment, root), '/operator/compiler');
    assert.equal(currentCompilerExecutable('/caller/compiler', {}, root), '/caller/compiler');
  } finally {
    t.mock.restoreAll();
    await rm(root, { recursive: true, force: true });
  }
  assert.deepEqual(written, ['compiler: /operator/compiler (TRILLION3D_COMPILER_BIN)\n']);
});

// Behaviour: with nothing to compare — no binary yet, or a binary without its crate beside it,
// as an installed package ships it — there is no refusal; a missing binary is reported at launch.
test('no binary or no crate sources is not a refusal', async () => {
  const { root, binary } = await crate(1_000, 2_000);
  try {
    assert.equal(sourceNewerThan(binary, join(root, 'absent')), null);
    await rm(binary);
    assert.equal(sourceNewerThan(binary, root), null);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

// Behaviour: the page codec the compiler links is built into it: an edit there is a stale build.
test('editing the page codec beside the crate reports the compiler stale', async () => {
  const packages = await mkdtemp(join(tmpdir(), 'trillion3d-freshness-'));
  const root = join(packages, 'asset-compiler-rust'),
    binary = join(root, 'target/release', binaryName),
    codec = join(packages, 'page-codec-wasm/src/lib.rs');
  try {
    await mkdir(join(root, 'target/release'), { recursive: true });
    await mkdir(join(packages, 'page-codec-wasm/src'), { recursive: true });
    for (const file of [join(root, 'Cargo.toml'), codec, binary]) await writeFile(file, '');
    await utimes(join(root, 'Cargo.toml'), 1_000, 1_000);
    await utimes(codec, 1_000, 1_000);
    await utimes(binary, 2_000, 2_000);
    assert.equal(sourceNewerThan(binary, root), null);
    await utimes(codec, 3_000, 3_000);
    assert.equal(sourceNewerThan(binary, root), codec);
  } finally {
    await rm(packages, { recursive: true, force: true });
  }
});
