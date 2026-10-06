import assert from 'node:assert/strict'
import test from 'node:test'
import {
  getTrillion3dTools,
  toAnthropicTool,
  toGeminiTool,
  toMcpTool,
  toOpenAiTool,
} from './toolDefinitions.ts'
import { TRILLION3D_RUNTIME_TOOLS } from './runtimeToolsSchema.ts'
import type { Trillion3dTool } from './types.ts'

const tool: Trillion3dTool = {
  name: 'host_render',
  description: 'Render the selected host scene.',
  parameters: {
    type: 'object',
    properties: { scene: { type: 'string', description: 'Scene to render.' } },
    required: ['scene'],
  },
}
const { name, description, parameters } = tool

test('provider conversions carry the whole tool, its argument schema shared, never copied', () => {
  assert.deepEqual(toOpenAiTool(tool), {
    type: 'function',
    function: { name, description, parameters },
  })
  assert.deepEqual(toAnthropicTool(tool), { name, description, input_schema: parameters })
  assert.deepEqual(toGeminiTool(tool), { name, description, parameters })
  assert.deepEqual(toMcpTool(tool), { name, description, inputSchema: parameters })
  assert.equal(toOpenAiTool(tool).function.parameters, parameters)
})

test('each format lists every callable tool, in order, with its provider-specific argument field', () => {
  assert.deepEqual(getTrillion3dTools(), getTrillion3dTools('openai'))
  const formats = {
    openai: (converted: unknown) => (converted as ReturnType<typeof toOpenAiTool>).function,
    anthropic: (converted: unknown) => {
      const { input_schema, ...rest } = converted as ReturnType<typeof toAnthropicTool>
      return { ...rest, parameters: input_schema }
    },
    gemini: (converted: unknown) => converted as ReturnType<typeof toGeminiTool>,
    mcp: (converted: unknown) => {
      const { inputSchema, ...rest } = converted as ReturnType<typeof toMcpTool>
      return { ...rest, parameters: inputSchema }
    },
  } as const
  for (const [format, read] of Object.entries(formats)) {
    const converted = getTrillion3dTools(format as keyof typeof formats)
    assert.equal(converted.length, TRILLION3D_RUNTIME_TOOLS.length, format)
    converted.forEach((value, index) => {
      const original = TRILLION3D_RUNTIME_TOOLS[index]
      assert.notEqual(value, original, format)
      const { name, description, parameters } = read(value)
      assert.equal(name, original.name, format)
      assert.equal(description, original.description, format)
      assert.equal(parameters, original.parameters, format)
    })
  }
  const raw = getTrillion3dTools('json-schema')
  assert.deepEqual(raw, TRILLION3D_RUNTIME_TOOLS)
  raw.pop()
  assert.equal(getTrillion3dTools('json-schema').length, TRILLION3D_RUNTIME_TOOLS.length)
})
