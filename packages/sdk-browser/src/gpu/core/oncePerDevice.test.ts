// #989: a build made once a device is shared; a failed one — rejected or made nothing — is not.
import test from 'node:test';
import assert from 'node:assert/strict';
import { oncePerDevice } from './oncePerDevice.ts';

test('a device keeps what was made, never a failed build', async () => {
  const device = {} as GPUDevice;
  const builds = [
    () => undefined,
    () => {
      throw new Error('lost');
    },
    () => 'made',
  ];
  let calls = 0;
  const make = oncePerDevice(async () => builds[calls++]());
  for (const expected of [undefined, 'reject', 'made', 'made'])
    if (expected === 'reject') await assert.rejects(make(device) as Promise<unknown>);
    else assert.equal(await make(device), expected);
  assert.equal(calls, 3);
});
