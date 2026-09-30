import assert from 'node:assert/strict';
import test from 'node:test';
import { Ajv } from 'ajv';
import { TRILLION3D_RUNTIME_TOOLS } from './runtimeToolsSchema.ts';
import { COMPILER_OPTIONS_SCHEMA } from './compilerOptionsSchema.ts';
import { EXPLORER_OPTIONS_SCHEMA } from './explorerOptionsSchema.ts';

const ajv = new Ajv({ allErrors: true });
const compiler = { source: 'model.glb', cache: 'cache/model', resourceBaseUrl: '/assets/model/' };
const explorer = { manifestUrl: '/assets/model/manifest.json' };

test('every callable tool has a unique API name and a consumable parameter schema', () => {
  const seen = new Set<string>();
  for (const tool of TRILLION3D_RUNTIME_TOOLS) {
    assert.match(tool.name, /^trillion3d_[a-z_]+$/);
    assert.equal(seen.has(tool.name), false);
    seen.add(tool.name);
    assert.ok(tool.description.trim().length > 0);
    assert.equal(ajv.validateSchema(tool.parameters), true);
    for (const property of Object.values(tool.parameters.properties)) {
      assert.ok(property.description.trim().length > 0);
      if (property.items) assert.ok(property.items.description.trim().length > 0);
    }
  }
  for (const schema of [COMPILER_OPTIONS_SCHEMA, EXPLORER_OPTIONS_SCHEMA])
    assert.ok(schema.description?.trim().length);
});

test('runtime tools accept host commands and reject invalid arguments before dispatch', () => {
  const commands: Record<string, [unknown, unknown[]]> = {
    trillion3d_create_explorer: [explorer, [{}, { manifestUrl: 1 }]],
    trillion3d_compile_asset: [compiler, [{}, { ...compiler, threads: 0 }]],
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
    trillion3d_add_light: [
      {
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
      [{}, { id: 'lamp', kind: 'unknown', color: [1, 1, 1], intensity: 1 }],
    ],
    trillion3d_remove_light: [{ id: 'lamp' }, [{}, { id: 2 }, { id: 'lamp', extra: 1 }]],
    trillion3d_set_diagnostic: [
      { mode: 'normal' },
      [{}, { mode: 'unknown' }, { mode: 'normal', extra: 1 }],
    ],
    trillion3d_get_metrics: [{}, [{ extra: 1 }]],
  };
  for (const [name, [valid, invalid]] of Object.entries(commands)) {
    const tool = TRILLION3D_RUNTIME_TOOLS.find((t) => t.name === name);
    assert.ok(tool, name);
    const validate = ajv.compile(tool.parameters);
    assert.equal(validate(valid), true, name);
    for (const input of invalid)
      assert.equal(validate(input), false, `${name}: ${JSON.stringify(input)}`);
  }
});
