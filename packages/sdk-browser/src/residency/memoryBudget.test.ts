// The effect chain's targets in the GPU total (#349, #483 rule 5): reserved on the declared canvas
// by the rule the renderers count them with, before the pools, whose defaults stay what they were.
import test from 'node:test';
import assert from 'node:assert/strict';
import { effectChainBytesAt } from '../effects/targets.ts';
import { DEFAULT_GEOMETRY_POOL_BUDGET } from './pools.ts';
import { DEFAULT_TEXTURE_POOL_BUDGET } from './pools.ts';
import { bounceProbeBytes } from '../bounce/limits.ts';
import { BOUNCE_SETTINGS } from '../../../sdk-core/src/bounce/contracts.ts';
import { defaultGpuBudget, SHADOW_GRANT_BYTES } from './memoryBudget.ts';
import { SHADOW_BATCH_GPU_BYTES } from '../gpu/shadow/batchBudget.ts';

const BOUNCE_PROBE_BYTES =
  2 * bounceProbeBytes(BOUNCE_SETTINGS.cascadeLevels * BOUNCE_SETTINGS.cascadeSize ** 3);
const DEFAULT_GPU_BUDGET = defaultGpuBudget();
const SHADOW_POOL_BYTES = SHADOW_GRANT_BYTES + SHADOW_BATCH_GPU_BYTES;

const [width, height] = [3840, 2160];
const MiB = 1024 * 1024;

test('the default GPU total grows by exactly that reserve, and each pool keeps 512 MiB', () => {
  const before = SHADOW_POOL_BYTES + BOUNCE_PROBE_BYTES + 1024 * MiB;
  assert.equal(DEFAULT_GPU_BUDGET - before, effectChainBytesAt(width, height));
  assert.equal(DEFAULT_GEOMETRY_POOL_BUDGET, 512 * MiB);
  assert.equal(DEFAULT_TEXTURE_POOL_BUDGET, 512 * MiB);
});
