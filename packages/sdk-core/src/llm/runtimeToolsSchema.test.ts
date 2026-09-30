import assert from 'node:assert/strict';
import test from 'node:test';
import { Ajv } from 'ajv';
import { TRILLION3D_RUNTIME_TOOLS } from './runtimeToolsSchema.ts';
import { COMPILER_OPTIONS_SCHEMA } from './compilerOptionsSchema.ts';
import { EXPLORER_OPTIONS_SCHEMA } from './explorerOptionsSchema.ts';
import { DIAGNOSTICS, type DiagnosticMode } from '../runtime/diagnostics.ts';
import { validateSceneLight } from '../scene/light/validate.ts';
import type { SceneLight } from '../scene/light/contracts.ts';

const ajv = new Ajv();
const tool = (name: string) => {
  const found = TRILLION3D_RUNTIME_TOOLS.find((candidate) => candidate.name === name);
  assert.ok(found, name);
  return found;
};
const validatorOf = (name: string, options?: ConstructorParameters<typeof Ajv>[0]) =>
  (options ? new Ajv(options) : ajv).compile(tool(name).parameters);

test('every callable tool has a unique API name and a described, well-formed argument schema', () => {
  const seen = new Set<string>();
  for (const { name, description, parameters } of TRILLION3D_RUNTIME_TOOLS) {
    assert.match(name, /^trillion3d_[a-z_]+$/);
    assert.equal(seen.has(name), false, name);
    seen.add(name);
    assert.ok(description.trim().length > 0, name);
    assert.equal(ajv.validateSchema(parameters), true, name);
    for (const property of Object.values(parameters.properties)) {
      assert.ok(property.description.trim().length > 0, name);
      if (property.items) assert.ok(property.items.description.trim().length > 0, name);
    }
  }
  assert.equal(tool('trillion3d_create_explorer').parameters, EXPLORER_OPTIONS_SCHEMA);
  assert.equal(tool('trillion3d_compile_asset').parameters, COMPILER_OPTIONS_SCHEMA);
  for (const schema of [COMPILER_OPTIONS_SCHEMA, EXPLORER_OPTIONS_SCHEMA])
    assert.ok(schema.description?.trim().length);
});

test('runtime tools accept host commands and refuse invalid arguments before dispatch', () => {
  const commands: Record<string, [unknown, unknown[]]> = {
    trillion3d_set_memory_budgets: [
      { geometryPoolBytes: 134217728, texturePoolBytes: 268435456 },
      [{ geometryPoolBytes: 1 }, { texturePoolBytes: '128' }, { extra: 1 }],
    ],
    trillion3d_set_lod_error: [
      { pixelError: 0.5 },
      [{}, { pixelError: -1 }, { pixelError: '1' }, { pixelError: 1, extra: 1 }],
    ],
    trillion3d_set_temporal_antialiasing: [
      { enabled: true },
      [{}, { enabled: 1 }, { enabled: true, extra: 1 }],
    ],
    trillion3d_remove_light: [{ id: 'lamp' }, [{}, { id: 2 }, { id: 'lamp', extra: 1 }]],
    trillion3d_get_metrics: [{}, [{ extra: 1 }]],
  };
  for (const [name, [valid, invalid]] of Object.entries(commands)) {
    const validate = validatorOf(name);
    assert.equal(validate(valid), true, name);
    for (const input of invalid)
      assert.equal(validate(input), false, `${name}: ${JSON.stringify(input)}`);
  }
});

test('the diagnostic tool offers exactly the view modes the engine can show', () => {
  const validate = validatorOf('trillion3d_set_diagnostic');
  for (const mode of Object.keys(DIAGNOSTICS) as DiagnosticMode[])
    assert.equal(validate({ mode }), DIAGNOSTICS[mode].available, mode);
  for (const input of [{}, { mode: 'unknown' }, { mode: 'wireframe', extra: 1 }])
    assert.equal(validate(input), false, JSON.stringify(input));
});

test('a light the tool accepts, the engine accepts; a field bound it refuses, the engine refuses', () => {
  const validate = validatorOf('trillion3d_add_light');
  const complete = {
    point: {
      id: 'bulb',
      kind: 'point',
      color: [1, 0.8, 0.6],
      intensity: 3,
      position: [0, 2, 0],
      range: 8,
    },
    spot: {
      id: 'lamp',
      kind: 'spot',
      color: [0.1, 0.5, 1],
      intensity: 2,
      position: [1, 2, 3],
      direction: [0, -1, 0],
      range: 10,
      coneAngle: 0.5,
      castsShadow: true,
    },
    directional: {
      id: 'sun',
      kind: 'directional',
      color: [1, 1, 1],
      intensity: 4,
      direction: [0, -1, 0],
    },
  };
  const engineAccepts = (light: object) => {
    try {
      validateSceneLight(light as SceneLight);
      return true;
    } catch {
      return false;
    }
  };
  for (const light of Object.values(complete)) {
    assert.equal(validate(light), true, light.kind);
    assert.equal(engineAccepts(light), true, light.kind);
  }
  for (const key of ['id', 'kind', 'color', 'intensity']) {
    const input: Record<string, unknown> = { ...complete.point };
    delete input[key];
    assert.equal(validate(input), false, `missing ${key}`);
    assert.equal(engineAccepts(input), false, `missing ${key}`);
  }
  for (const [kind, patch] of [
    ['point', { id: 7 }],
    ['point', { kind: 'lantern' }],
    ['point', { kind: 1 }],
    ['point', { color: 'white' }],
    ['point', { color: [0, -0.1, 1] }],
    ['point', { intensity: -1 }],
    ['point', { intensity: 'bright' }],
    ['point', { position: 5 }],
    ['point', { position: [0, 'up', 1] }],
    ['point', { range: 0 }],
    ['point', { range: 'far' }],
    ['spot', { direction: 5 }],
    ['spot', { direction: [0, 'up', 1] }],
    ['spot', { coneAngle: 0 }],
    ['spot', { coneAngle: Math.PI / 2 }],
    ['spot', { coneAngle: 1.6 }],
    ['spot', { coneAngle: 'wide' }],
  ] as const) {
    const input = { ...complete[kind], ...patch };
    assert.equal(validate(input), false, JSON.stringify(patch));
    assert.equal(engineAccepts(input), false, JSON.stringify(patch));
  }
  // The tool's own strictness, which the engine does not share: a flag spelled as text, a field
  // it does not know.
  for (const patch of [{ castsShadow: 'true' }, { misspelledOption: true }])
    assert.equal(validate({ ...complete.point, ...patch }), false, JSON.stringify(patch));
});

test('a light that says nothing of shadows gets what the engine makes of that silence', () => {
  const validate = validatorOf('trillion3d_add_light', { useDefaults: true });
  const light: Record<string, unknown> = {
    id: 'sun',
    kind: 'directional',
    color: [1, 1, 1],
    intensity: 4,
    direction: [0, -1, 0],
  };
  const engine = validateSceneLight({ ...light } as unknown as SceneLight);
  assert.equal(validate(light), true);
  assert.equal(light.castsShadow, engine.castsShadow);
});
