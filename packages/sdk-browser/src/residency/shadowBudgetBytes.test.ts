import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SHADOW_ATLAS_BYTES,
  SHADOW_GRANT_BYTES,
  SHADOW_HOST_BYTES,
  SHADOW_POOL_BYTES,
} from './shadowBudgetBytes.ts';
import { DEFAULT_CPU_BUDGET, defaultGpuBudget, splitMemoryBudget } from './memoryBudget.ts';
import * as leanSizes from '../gpu/shadow/sizes.ts';
import { shadowRequestBytes } from '../webgpu/shadow/allocLayout.ts';
import { shadowAtlasBytes } from '../gpu/shadow/atlas.ts';
import { shadowTransmittanceBytes } from '../gpu/shadow/transmittance.ts';
import { SHADOW_BATCH_GPU_BYTES } from '../gpu/shadow/batchBudget.ts';
import {
  shadowPoolShape,
  shadowPoolSize,
} from '../../../sdk-core/src/scene/light-shadow/virtual.ts';

test('the shadow shares read from the lean size modules are the very bytes of before (#1353)', () => {
  // The full modules the passes size their pool with read the lean modules' very functions, and
  // the grant recomposed from the full modules is the budget's to the byte.
  assert.equal(shadowAtlasBytes, leanSizes.shadowAtlasBytes);
  assert.equal(shadowTransmittanceBytes, leanSizes.shadowTransmittanceBytes);
  const { side, layers } = shadowPoolShape(shadowPoolSize(3840, 2160));
  assert.equal(SHADOW_ATLAS_BYTES, shadowAtlasBytes(side, layers));
  assert.equal(
    SHADOW_GRANT_BYTES,
    2 * shadowAtlasBytes(side, layers) +
      shadowTransmittanceBytes(side, layers) +
      leanSizes.SHADOW_BUFFER_BYTES +
      shadowRequestBytes(side * side * layers),
  );
  assert.equal(SHADOW_POOL_BYTES, SHADOW_GRANT_BYTES + SHADOW_BATCH_GPU_BYTES);
  // The bytes pinned: #1353 kept `develop`'s 939_423_092, 944_835_216 and 27_370_080; #831 changes
  // the pool's layout on purpose — a third field read back (`drawnBy`), the table words' pairs
  // capped at 5 per page (`wordsCap`), pair lists of a fixed size, the host
  // table's list of the entries sent, the GPU draws' static fill (`budget`, four words with its
  // padding) — hence these.
  assert.deepEqual(
    [SHADOW_GRANT_BYTES, SHADOW_POOL_BYTES, SHADOW_HOST_BYTES],
    [939_468_580, 944_880_704, 27_459_968],
  );
  const { shadowPool, shadowMirror } = splitMemoryBudget(defaultGpuBudget(), DEFAULT_CPU_BUDGET);
  assert.deepEqual([shadowPool, shadowMirror], [SHADOW_POOL_BYTES, SHADOW_HOST_BYTES]);
});
