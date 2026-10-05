import assert from 'node:assert/strict';
import test from 'node:test';
import { Ajv } from 'ajv';
import { EXPLORER_OPTIONS_SCHEMA } from './explorerOptionsSchema.ts';
import { BOUNCE_SETTINGS } from '../bounce/contracts.ts';
import { SCREEN_ERROR_VARIANTS } from '../lod/screenErrorVariants.ts';
import type { MathPathMode } from '../math/path/contracts.ts';
import { explorerSwitch, type ExplorerSwitch } from '../runtime/explorerSwitches.ts';
import { EXPLORER_SWITCH_NAMES } from '../runtime/explorerSwitches.fixture.ts';
import {
  DEFAULT_GEOMETRY_POOL_BUDGET,
  DEFAULT_TEXTURE_POOL_BUDGET,
} from '../../../sdk-browser/src/residency/pools.ts';
import { DEFAULT_TEXTURE_UPLOAD_MS } from '../../../sdk-browser/src/residency/textureTransferDefaults.ts';

const validate = new Ajv().compile(EXPLORER_OPTIONS_SCHEMA);
const explorer = { manifestUrl: '/assets/model/manifest.json' };

test('explorer arguments accept a complete host request and keep host extensions', () => {
  assert.equal(
    validate({
      ...explorer,
      interactive: true,
      scope: 'full',
      geometryPoolBytes: 134217728,
      geometryPoolCeilingBytes: 268435456,
      texturePoolBytes: 134217728,
      maxTextureUploadMsPerFrame: 2,
      temporalAntialiasing: false,
      pixelError: 1.5,
      lodAdaptive: true,
      bounce: true,
      bounceBudgetMs: 1,
      importedLights: false,
      mathPath: 'js',
      screenError: 'reference',
      textureSource: 'host',
      preload: 'all',
      autonomousGeometry: true,
      stageProfile: true,
      diagnosticDetail: 'trace',
      replicaCount: 4,
      clearColor: 0x123456,
      hostExtension: 'kept',
    }),
    true,
  );
});

test('explorer arguments name every choice the engine takes and refuse the rest', () => {
  for (const mathPath of ['auto', 'js', 'wasm'] satisfies MathPathMode[])
    assert.equal(validate({ ...explorer, mathPath }), true, mathPath);
  for (const screenError of SCREEN_ERROR_VARIANTS)
    assert.equal(validate({ ...explorer, screenError }), true, screenError);
  assert.equal(validate({}), false);
  assert.equal(validate({ manifestUrl: false }), false);
  for (const field of [
    'interactive',
    'temporalAntialiasing',
    'lodAdaptive',
    'bounce',
    'importedLights',
    'autonomousGeometry',
    'stageProfile',
  ])
    assert.equal(validate({ ...explorer, [field]: 'true' }), false, field);
  for (const field of [
    'scope',
    'mathPath',
    'screenError',
    'textureSource',
    'preload',
    'diagnosticDetail',
  ])
    assert.equal(validate({ ...explorer, [field]: 'unknown' }), false, field);
  for (const patch of [
    { geometryPoolBytes: 1 },
    { geometryPoolBytes: 'bytes' },
    { texturePoolBytes: 1 },
    { texturePoolBytes: 67108864.5 },
    { geometryPoolCeilingBytes: 0.5 },
    { maxTextureUploadMsPerFrame: -1 },
    { maxTextureUploadMsPerFrame: 17 },
    { pixelError: -1 },
    { pixelError: 'pixels' },
    { bounceBudgetMs: 0 },
    { bounceBudgetMs: 9 },
    { replicaCount: 2 },
    { replicaCount: '4' },
    { clearColor: 0.5 },
  ])
    assert.equal(validate({ ...explorer, ...patch }), false, JSON.stringify(patch));
});

test('an explorer request naming only its manifest is completed with the engine defaults', () => {
  const request: Record<string, unknown> = { ...explorer };
  assert.equal(new Ajv({ useDefaults: true }).compile(EXPLORER_OPTIONS_SCHEMA)(request), true);
  assert.equal(request.geometryPoolBytes, DEFAULT_GEOMETRY_POOL_BUDGET);
  assert.equal(request.texturePoolBytes, DEFAULT_TEXTURE_POOL_BUDGET);
  assert.equal(request.maxTextureUploadMsPerFrame, DEFAULT_TEXTURE_UPLOAD_MS);
  assert.equal(request.bounceBudgetMs, BOUNCE_SETTINGS.budgetMs);
  for (const [key, property] of Object.entries(EXPLORER_OPTIONS_SCHEMA.properties)) {
    if (property.default === undefined) continue;
    assert.notEqual(request[key], undefined, key);
    // Each default, alone, passes the checks of its own field.
    assert.equal(validate({ ...explorer, [key]: request[key] }), true, key);
  }
});

test('a switch the host leaves out is set in the engine as the schema advertises it', () => {
  const advertised = Object.entries(EXPLORER_OPTIONS_SCHEMA.properties).filter(
    ([, property]) => property.type === 'boolean' && property.default !== undefined,
  );
  assert.deepEqual(advertised.map(([key]) => key).sort(), [...EXPLORER_SWITCH_NAMES].sort());
  for (const [key, property] of advertised)
    assert.equal(explorerSwitch({}, key as ExplorerSwitch), property.default, key);
});
