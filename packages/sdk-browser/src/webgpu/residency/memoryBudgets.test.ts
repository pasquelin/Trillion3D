import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_TEXTURE_TRANSFER_BYTES,
  DEFAULT_TEXTURE_UPLOAD_MS,
  textureTransferBytesFor,
  textureUploadMsFor,
} from './memoryBudgets.ts';

test('the tile pass budgets are what the host declared, 16 MiB and 1 ms by default, one tile at least', () => {
  assert.equal(textureUploadMsFor(undefined), DEFAULT_TEXTURE_UPLOAD_MS);
  assert.equal(textureUploadMsFor(Number.NaN), DEFAULT_TEXTURE_UPLOAD_MS);
  assert.equal(textureUploadMsFor(0.25), 0.25);
  assert.equal(textureUploadMsFor(-3), 0, 'a negative budget still lands one tile per pass');
  assert.equal(textureTransferBytesFor(undefined), DEFAULT_TEXTURE_TRANSFER_BYTES);
  assert.equal(textureTransferBytesFor(Number.POSITIVE_INFINITY), DEFAULT_TEXTURE_TRANSFER_BYTES);
  assert.equal(textureTransferBytesFor(4096), 4096);
  assert.equal(textureTransferBytesFor(0), 1, 'a zero byte budget still lands one tile per pass');
});
