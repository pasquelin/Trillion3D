import assert from 'node:assert/strict';
import test from 'node:test';
import {
  getTrillion3dTools,
  toAnthropicTool,
  toGeminiTool,
  toMcpTool,
  toOpenAiTool,
} from './toolDefinitions.ts';
import { TRILLION3D_RUNTIME_TOOLS } from './runtimeToolsSchema.ts';
import type { Trillion3dTool } from './types.ts';

const tool: Trillion3dTool = {
  name: 'host_render',
  description: 'Render the selected host scene.',
  parameters: {
    type: 'object',
    properties: { scene: { type: 'string', description: 'Scene to render.' } },
    required: ['scene'],
  },
};

test('provider conversions preserve the complete host tool payload', () => {
  assert.deepEqual(toOpenAiTool(tool), {
    type: 'function',
    function: {
      name: 'host_render',
      description: 'Render the selected host scene.',
      parameters: tool.parameters,
    },
  });
  assert.deepEqual(toAnthropicTool(tool), {
    name: 'host_render',
    description: 'Render the selected host scene.',
    input_schema: tool.parameters,
  });
  assert.deepEqual(toGeminiTool(tool), {
    name: 'host_render',
    description: 'Render the selected host scene.',
    parameters: tool.parameters,
  });
  assert.deepEqual(toMcpTool(tool), {
    name: 'host_render',
    description: 'Render the selected host scene.',
    inputSchema: tool.parameters,
  });
  assert.equal(toOpenAiTool(tool).function.parameters, tool.parameters);
  assert.equal(toAnthropicTool(tool).input_schema, tool.parameters);
  assert.equal(toGeminiTool(tool).parameters, tool.parameters);
  assert.equal(toMcpTool(tool).inputSchema, tool.parameters);
});

test('format dispatch exposes every callable tool with its provider-specific argument field', () => {
  assert.deepEqual(getTrillion3dTools(), getTrillion3dTools('openai'));
  for (const [format, key] of [
    ['anthropic', 'input_schema'],
    ['gemini', 'parameters'],
    ['mcp', 'inputSchema'],
  ] as const) {
    const converted = getTrillion3dTools(format) as unknown as Array<Record<string, unknown>>;
    assert.equal(converted.length, TRILLION3D_RUNTIME_TOOLS.length);
    converted.forEach((value, index) => {
      const original = TRILLION3D_RUNTIME_TOOLS[index];
      assert.notEqual(
        value,
        original,
        'provider tool wrappers must not alias the shared catalogue',
      );
      assert.equal(value.name, original.name);
      assert.equal(value.description, original.description);
      assert.equal(value[key], original.parameters);
    });
  }
  const raw = getTrillion3dTools('json-schema');
  assert.deepEqual(raw, TRILLION3D_RUNTIME_TOOLS);
  assert.notEqual(raw, TRILLION3D_RUNTIME_TOOLS);
  raw.pop();
  assert.equal(getTrillion3dTools('json-schema').length, TRILLION3D_RUNTIME_TOOLS.length);
});
