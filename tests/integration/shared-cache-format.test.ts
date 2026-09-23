// The cache format number is written twice — once in Rust, once in TypeScript — and one product
// is read by both. Nothing in a compilation compares them, so a raise applied on one side only
// would be seen by a rendered proof and by nothing else. This test compares them directly: the
// constants of `compiler_format.rs` against those of `sdk-core`, and the descriptor the compiler
// publishes (`--version`) against the number the runtime reads.
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  CLUSTERED_BLEND_FORMAT_VERSION,
  FORMAT_VERSION,
} from '../../packages/sdk-core/src/index.ts';

const rust = fileURLToPath(
  new URL('../../packages/asset-compiler-rust/src/compiler_format.rs', import.meta.url),
);
const compiler = fileURLToPath(
  new URL(
    '../../packages/asset-compiler-rust/target/release/web-geometry-compiler',
    import.meta.url,
  ),
);

/** Value of a `pub const NAME: u32 = N;` of the compiler's format module. */
function rustConstant(name: string) {
  const found = new RegExp(`pub const ${name}: u32 = (\\d+);`).exec(readFileSync(rust, 'utf8'));
  assert.ok(found, `${name} is not declared in compiler_format.rs`);
  return Number(found[1]);
}

test('the compiler and the runtime number the cache format alike', () => {
  assert.equal(rustConstant('FORMAT_VERSION'), FORMAT_VERSION);
  assert.equal(rustConstant('CLUSTERED_BLEND_FORMAT_VERSION'), CLUSTERED_BLEND_FORMAT_VERSION);
});

// The binary is built by the `native` gate group before the unit suite runs; a checkout that has
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
