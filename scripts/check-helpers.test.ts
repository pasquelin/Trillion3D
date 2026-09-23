import test from 'node:test';
import assert from 'node:assert/strict';
import { duplicateHelpers, isTestModule } from './check-helpers.ts';

const SHARED = `pub fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
`;

test('a copied two-line Rust helper is red, and names both modules', () => {
  const groups = duplicateHelpers(
    new Map([
      ['packages/asset-compiler-rust/src/shared_math.rs', SHARED],
      [
        'packages/asset-compiler-rust/src/coplanar/plane.rs',
        '/// planted\nfn dot(u: [f64; 3], v: [f64; 3]) -> f64 {\n    a[0] * b[0] + a[1] * b[1] + a[2] * b[2] // same\n}\n',
      ],
    ]),
  );
  assert.equal(groups.length, 1);
  assert.deepEqual(
    groups[0].map((h) => h.file),
    [
      'packages/asset-compiler-rust/src/shared_math.rs',
      'packages/asset-compiler-rust/src/coplanar/plane.rs',
    ],
  );
});

test('a copied TypeScript arrow helper is red', () => {
  const copy =
    'const words = (bytes: Uint8Array) =>\n  new Uint32Array(bytes.buffer, bytes.byteOffset, bytes.byteLength / 4);\n';
  const groups = duplicateHelpers(
    new Map([
      ['packages/sdk-browser/src/a/one.ts', copy],
      ['packages/sdk-browser/src/b/two.ts', `export ${copy}`],
    ]),
  );
  assert.equal(groups.length, 1);
});

test('same name and signature with a different body is not a copy', () => {
  const groups = duplicateHelpers(
    new Map([
      ['packages/sdk-core/src/a.ts', 'function unit(v: number): number {\n  return v / 2;\n}\n'],
      ['packages/sdk-core/src/b.ts', 'function unit(v: number): number {\n  return v / 3;\n}\n'],
    ]),
  );
  assert.deepEqual(groups, []);
});

test('copies in two packages, in tests, in inline test modules or in methods are not reported', () => {
  const groups = duplicateHelpers(
    new Map([
      ['packages/sdk-core/src/a.ts', 'function f(x: number) {\n  return x;\n}\n'],
      ['packages/sdk-browser/src/a.ts', 'function f(x: number) {\n  return x;\n}\n'],
      ['packages/sdk-core/src/a.test.ts', 'function f(x: number) {\n  return x;\n}\n'],
      ['packages/page-codec-wasm/src/lib.rs', SHARED],
      ['packages/page-codec-wasm/src/math.rs', `#[cfg(test)]\nmod tests {\n    ${SHARED}}\n`],
      [
        'packages/page-codec-wasm/src/bits.rs',
        'impl A {\n    pub fn dot(&self, b: [f64; 3]) -> f64 {\n        0.0\n    }\n}\n',
      ],
    ]),
  );
  assert.deepEqual(groups, []);
  assert.ok(isTestModule('/tests/formats/golden.rs') && isTestModule('/qem_tests.rs'));
  assert.ok(!isTestModule('/qem.rs'));
});
