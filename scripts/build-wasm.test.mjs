// `verifieJeuInstructions` rejects any module that does not carry `simd128`, or that carries a
// "relaxed" feature — the only WebAssembly instruction family with non-guaranteed rounding, which would break
// bit-for-bit equality of `packages/page-codec-wasm/src/math.rs` kernels. Each case is a minimal dummy
// WebAssembly module (header + custom `target_features` section), without going through
// `cargo build`: importing this script never triggers it (`main()` only runs via CLI).
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { verifieJeuInstructions } from './build-wasm.mjs';

/** An unsigned integer in LEB128, as required by WebAssembly binary format lengths. */
function leb128(n) {
  const octets = [];
  do {
    let octet = n & 0x7f;
    n >>>= 7;
    if (n) octet |= 0x80;
    octets.push(octet);
  } while (n);
  return octets;
}

/**
 * A minimal valid WebAssembly module — header only — carrying a single custom section
 * `target_features` whose content is the given text: exactly what `verifieJeuInstructions` reads,
 * without depending on a real capability encoding.
 */
function moduleFactice(texteCapacites) {
  const entete = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];
  const nom = Buffer.from('target_features', 'utf8');
  const charge = Buffer.from(texteCapacites, 'latin1');
  const corps = [...leb128(nom.length), ...nom, ...charge];
  return Buffer.from([...entete, 0x00, ...leb128(corps.length), ...corps]);
}

function fichierFactice(dir, texteCapacites) {
  const chemin = join(dir, 'factice.wasm');
  writeFileSync(chemin, moduleFactice(texteCapacites));
  return chemin;
}

test('a module with simd128 and without relaxed feature is accepted', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wg-build-wasm-'));
  try {
    assert.doesNotThrow(() => verifieJeuInstructions(fichierFactice(dir, '+simd128')));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a module without simd128 is rejected', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wg-build-wasm-'));
  try {
    assert.throws(
      () => verifieJeuInstructions(fichierFactice(dir, '+multivalue')),
      /simd128 missing/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a module carrying relaxed-simd is rejected even with simd128', () => {
  const dir = mkdtempSync(join(tmpdir(), 'wg-build-wasm-'));
  try {
    assert.throws(
      () => verifieJeuInstructions(fichierFactice(dir, '+simd128+relaxed-simd')),
      /"relaxed" capability present/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('importing the script does not run compilation', () => {
  // If `main()` ran on import, this test would fail long before reaching here: `cargo`
  // is not guaranteed to be installed on the machine running `pnpm test`.
  assert.equal(typeof verifieJeuInstructions, 'function');
});
