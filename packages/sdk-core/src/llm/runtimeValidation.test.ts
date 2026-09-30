import assert from 'node:assert/strict';
import test from 'node:test';
import { Ajv } from 'ajv';
import { TRILLION3D_RUNTIME_TOOLS } from './runtimeToolsSchema.ts';
import { EXPLORER_OPTIONS_SCHEMA } from './explorerOptionsSchema.ts';

test('every advertised diagnostic mode and math backend can be requested', () => {
  const ajv = new Ajv();
  const diagnostic = TRILLION3D_RUNTIME_TOOLS.find(
    (tool) => tool.name === 'trillion3d_set_diagnostic',
  );
  assert.ok(diagnostic);
  const validateMode = ajv.compile(diagnostic.parameters);
  for (const mode of [
    'none',
    'wireframe',
    'cluster',
    'lod',
    'depth',
    'normal',
    'albedo',
    'roughness',
    'metalness',
    'ao',
  ])
    assert.equal(validateMode({ mode }), true, mode);
  const validateExplorer = ajv.compile(EXPLORER_OPTIONS_SCHEMA);
  for (const mathPath of ['auto', 'js', 'wasm'])
    assert.equal(validateExplorer({ manifestUrl: 'manifest.json', mathPath }), true, mathPath);
});

test('light arguments preserve required fields, validate each attribute, and default shadows off', () => {
  const light = TRILLION3D_RUNTIME_TOOLS.find((tool) => tool.name === 'trillion3d_add_light');
  assert.ok(light);
  const validate = new Ajv({ useDefaults: true }).compile(light.parameters);
  const base = { id: 'sun', kind: 'directional', color: [0.2, 0.4, 1], intensity: 3 };
  for (const kind of ['point', 'spot', 'directional']) {
    const input = { ...base, kind };
    assert.equal(validate(input), true, kind);
    assert.equal((input as unknown as { castsShadow: boolean }).castsShadow, false);
  }
  for (const key of ['id', 'kind', 'color', 'intensity']) {
    const input: Record<string, unknown> = { ...base };
    delete input[key];
    assert.equal(validate(input), false, `missing ${key}`);
  }
  for (const patch of [
    { id: 7 },
    { kind: 1 },
    { color: 'white' },
    { color: [0, -0.1, 1] },
    { color: [0, 0.5, 1.1] },
    { intensity: -1 },
    { intensity: 'bright' },
    { position: 5 },
    { position: [0, 'up', 1] },
    { direction: 5 },
    { direction: [0, 'up', 1] },
    { range: 0 },
    { range: 'far' },
    { coneAngle: 0 },
    { coneAngle: 4 },
    { coneAngle: 'wide' },
    { castsShadow: 'true' },
    { misspelledOption: true },
  ])
    assert.equal(validate({ ...base, ...patch }), false, JSON.stringify(patch));
});
