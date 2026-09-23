import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { CUTOUT_SHEET_FILE, CUTOUT_SHEET_VERSION } from '../../packages/sdk-core/src/index.ts';

/**
 * The cutout answer sheet is the only format that both languages WRITE:
 * the compiler produces and re-reads it, a host rewrites it with human responses.
 * A drift between the two would break nothing at build time — it would cause sheet rejection on
 * next import, or worse, apply misread responses. The test therefore re-reads constants
 * in Rust, like an external reader, instead of borrowing them.
 */
const RUST = new URL('../../packages/asset-compiler-rust/src/cutout.rs', import.meta.url);

test('sheet name and version are identical on both sides', async () => {
  const source = await readFile(RUST, 'utf8');
  const file = source.match(/DECISIONS_FILE: &str = "([^"]+)"/u);
  const version = source.match(/SHEET_VERSION: u64 = (\d+)/u);
  assert.ok(file, 'the compiler always names its sheet');
  assert.ok(version, 'the compiler always versions its sheet');
  assert.equal(
    file[1],
    CUTOUT_SHEET_FILE,
    'the sheet name moved on the compiler side without moving in the contracts',
  );
  assert.equal(
    Number(version[1]),
    CUTOUT_SHEET_VERSION,
    'the sheet version moved on the compiler side without moving in the contracts',
  );
});
