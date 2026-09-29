// The cache format number is written twice — once in Rust, once in TypeScript — and one product
// is read by both. Nothing in a compilation compares them, so a raise applied on one side only
// would be seen by a rendered proof and by nothing else. This test compares them directly: the
// constants of `compiler_format.rs` against those of `sdk-core`, the version of `physics.json`
// against the one its reader accepts, and the descriptor the compiler publishes (`--version`)
// against the number the runtime reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CLUSTERED_BLEND_FORMAT_VERSION,
  FORMAT_VERSION,
  TEXTURE_PREVIEW_VERSION,
} from '../../packages/sdk-core/src/index.ts';
import { JOLT_COMMIT, readCookedPhysics } from '../../packages/sdk-core/src/physics/cooked.ts';
import { TILE_BORDER, TILE_SIZE } from '../../packages/sdk-browser/src/texture/tiles.ts';

const source = (file: string) =>
  fileURLToPath(new URL(`../../packages/asset-compiler-rust/src/${file}`, import.meta.url));
const compiler = fileURLToPath(
  new URL('../../packages/asset-compiler-rust/target/release/trillion3d-compiler', import.meta.url),
);

/** Value of a `pub const NAME: u32 = N;` of a compiler module. */
function rustConstant(name: string, file = 'compiler_format.rs') {
  const found = new RegExp(`pub const ${name}: u32 = (\\d+);`).exec(
    readFileSync(source(file), 'utf8'),
  );
  assert.ok(found, `${name} is not declared in ${file}`);
  return Number(found[1]);
}

test('the compiler and the runtime number the cache format alike', () => {
  assert.equal(rustConstant('FORMAT_VERSION'), FORMAT_VERSION);
  assert.equal(rustConstant('CLUSTERED_BLEND_FORMAT_VERSION'), CLUSTERED_BLEND_FORMAT_VERSION);
});

// #962: a block level file is laid out in the engine's tile records; the tile and its gutter are
// the same numbers on both sides, or every tile is cut at the wrong bytes.
test('the compiler lays texture levels out as the runtime reads them', () => {
  assert.equal(
    rustConstant('TEXTURE_PREVIEW_VERSION', 'texture_preview.rs'),
    TEXTURE_PREVIEW_VERSION,
  );
  assert.equal(rustConstant('TILE_SIZE', 'texture_preview/levels.rs'), TILE_SIZE);
  assert.equal(rustConstant('TILE_BORDER', 'texture_preview/levels.rs'), TILE_BORDER);
});

test('the physics.json the cook writes, with or without pieces, is a version its reader accepts', () => {
  for (const name of ['PHYSICS_FORMAT_VERSION', 'PIECES_FORMAT_VERSION']) {
    const formatVersion = rustConstant(name, 'physics_cook.rs');
    const file = { formatVersion, jolt: JOLT_COMMIT, colliders: [], instances: [] };
    assert.equal(readCookedPhysics(file).formatVersion, formatVersion);
  }
});

// The binary is built by the `unit` gate group before the unit suite runs; a checkout that has
// not built it keeps the comparison above, which needs no compiler.
test(
  'the compiler descriptor publishes the format the runtime reads',
  {
    skip: !existsSync(compiler),
  },
  () => {
    const descriptor = JSON.parse(execFileSync(compiler, ['--version'], { encoding: 'utf8' })) as {
      formatVersion: number;
    };
    assert.equal(descriptor.formatVersion, FORMAT_VERSION);
  },
);
