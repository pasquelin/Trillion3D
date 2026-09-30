import assert from 'node:assert/strict';
import test from 'node:test';
import { Ajv } from 'ajv';
import { COMPILER_OPTIONS_SCHEMA } from './compilerOptionsSchema.ts';
import { EXPLORER_OPTIONS_SCHEMA } from './explorerOptionsSchema.ts';

const ajv = new Ajv({ allErrors: true });
const compiler = { source: 'model.glb', cache: 'cache/model', resourceBaseUrl: '/assets/model/' };
const explorer = { manifestUrl: '/assets/model/manifest.json' };

test('compiler arguments accept a real job and reject missing, mistyped or unknown fields', () => {
  const validate = ajv.compile(COMPILER_OPTIONS_SCHEMA);
  assert.equal(
    validate({
      ...compiler,
      scope: 'full',
      triangleBudget: 1200,
      threads: 3,
      ramBudgetMb: 128,
      simplification: 'qem-endpoints',
    }),
    true,
  );
  for (const field of ['source', 'cache', 'resourceBaseUrl']) {
    const absent: Record<string, unknown> = { ...compiler };
    delete absent[field];
    assert.equal(validate(absent), false, `missing ${field}`);
    assert.equal(validate({ ...compiler, [field]: 42 }), false, `mistyped ${field}`);
  }
  for (const patch of [
    { scope: 'typo' },
    { scope: 1 },
    { simplification: 'typo' },
    { simplification: false },
    { threads: 0 },
    { threads: 1.5 },
    { ramBudgetMb: 63 },
    { ramBudgetMb: '128' },
    { triangleBudget: 2.5 },
    { misspelledOption: true },
  ])
    assert.equal(validate({ ...compiler, ...patch }), false, JSON.stringify(patch));
});

test('explorer arguments validate a complete host request while allowing host extensions', () => {
  const validate = ajv.compile(EXPLORER_OPTIONS_SCHEMA);
  const request = {
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
    shadowPageInvalidation: false,
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
  };
  assert.equal(validate(request), true);
  assert.equal(validate({}), false);
  assert.equal(validate({ manifestUrl: false }), false);
  for (const field of [
    'interactive',
    'temporalAntialiasing',
    'lodAdaptive',
    'shadowPageInvalidation',
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

test('schema defaults produce valid usable compiler and rendering requests', () => {
  const defaults = new Ajv({ useDefaults: true });
  const compileRequest = { ...compiler };
  const renderRequest = { ...explorer };
  assert.equal(defaults.compile(COMPILER_OPTIONS_SCHEMA)(compileRequest), true);
  assert.equal(defaults.compile(EXPLORER_OPTIONS_SCHEMA)(renderRequest), true);
  assert.deepEqual(compileRequest, {
    ...compiler,
    scope: 'slice',
    threads: 2,
    ramBudgetMb: 256,
    simplification: 'none',
  });
  assert.deepEqual(renderRequest, {
    ...explorer,
    interactive: false,
    scope: 'slice',
    geometryPoolBytes: 536870912,
    texturePoolBytes: 536870912,
    maxTextureUploadMsPerFrame: 1,
    temporalAntialiasing: true,
    pixelError: 0,
    lodAdaptive: false,
    shadowPageInvalidation: true,
    bounce: false,
    bounceBudgetMs: 0.8,
    importedLights: true,
    mathPath: 'auto',
    screenError: 'certifiee',
    textureSource: 'cache',
    preload: 'visible',
    autonomousGeometry: false,
    stageProfile: false,
    diagnosticDetail: 'summary',
    replicaCount: 1,
  });
});
