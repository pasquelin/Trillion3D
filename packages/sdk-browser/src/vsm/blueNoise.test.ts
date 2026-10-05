// The blue noise's void-and-cluster keeps each row's extrema and scans again only the rows a splat
// touches (`vsmVoidAndCluster`): the same splats in the same order, hence the same energies, and
// the same first-index extremum. The texture's texels are develop's, byte for byte: the digest
// below is that of develop's full scans, on the three production seeds, read from the upload.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createVsmBlueNoiseTexture } from './blueNoise.ts';
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts';

test("the texture's texels are develop's, byte for byte", () => {
  const { device, texelWrites } = fakeDevice();
  createVsmBlueNoiseTexture(device);
  const { data } = texelWrites[0];
  const digest = createHash('sha256')
    .update(new Uint8Array(data.buffer, data.byteOffset, data.byteLength))
    .digest('hex')
    .slice(0, 16);
  assert.equal(digest, '4e483f59cfa456bf');
});
