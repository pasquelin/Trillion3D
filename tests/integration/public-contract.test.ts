import test from 'node:test';
import assert from 'node:assert/strict';
import * as sdk from 'web-geometry';

test('Built public ESM exports work without DOM initialization', () => {
  assert.equal(sdk.SDK_VERSION, '0.2.0');
  sdk.assertFormat(sdk.FORMAT_VERSION);
  assert.equal(typeof sdk.prepare, 'function');
  assert.equal('createWorld' in sdk, false);
});

test('former consumer subpaths are not exported', async () => {
  for (const subpath of ['core', 'browser', 'node'])
    await assert.rejects(import(`web-geometry/${subpath}`), {
      code: 'ERR_PACKAGE_PATH_NOT_EXPORTED',
    });
});
