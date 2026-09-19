import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  EXPLORER_OPTIONS_SCHEMA,
  COMPILER_OPTIONS_SCHEMA,
  WEB_GEOMETRY_RUNTIME_TOOLS,
  getWebGeometryTools,
  getWebGeometryLlmPrompt,
  toOpenAiTool,
  toAnthropicTool,
  toGeminiTool,
  toMcpTool,
} from './index.ts';

describe('WebGeometry LLM Module', () => {
  it('exposes a valid JSON Schema for ExplorerOptions', () => {
    assert.equal(EXPLORER_OPTIONS_SCHEMA.type, 'object');
    assert.ok(EXPLORER_OPTIONS_SCHEMA.properties.manifestUrl);
    assert.ok(EXPLORER_OPTIONS_SCHEMA.properties.geometryPoolBytes);
    assert.ok(EXPLORER_OPTIONS_SCHEMA.properties.texturePoolBytes);
    assert.ok(EXPLORER_OPTIONS_SCHEMA.properties.temporalAntialiasing);
    assert.ok(EXPLORER_OPTIONS_SCHEMA.properties.pixelError);
    assert.ok(EXPLORER_OPTIONS_SCHEMA.properties.shadowBudgetMs);
    assert.ok(EXPLORER_OPTIONS_SCHEMA.properties.bounce);
    assert.deepEqual(EXPLORER_OPTIONS_SCHEMA.required, ['manifestUrl']);
  });

  it('exposes a valid JSON Schema for CompilerOptions', () => {
    assert.equal(COMPILER_OPTIONS_SCHEMA.type, 'object');
    assert.ok(COMPILER_OPTIONS_SCHEMA.properties.source);
    assert.ok(COMPILER_OPTIONS_SCHEMA.properties.cache);
    assert.ok(COMPILER_OPTIONS_SCHEMA.properties.resourceBaseUrl);
    assert.ok(COMPILER_OPTIONS_SCHEMA.properties.ramBudgetMb);
    assert.ok(COMPILER_OPTIONS_SCHEMA.properties.simplification);
  });

  it('declares runtime tools including memory, lighting and diagnostics', () => {
    assert.ok(WEB_GEOMETRY_RUNTIME_TOOLS.length >= 7);
    const names = WEB_GEOMETRY_RUNTIME_TOOLS.map((t) => t.name);
    assert.ok(names.includes('web_geometry_create_explorer'));
    assert.ok(names.includes('web_geometry_set_memory_budgets'));
    assert.ok(names.includes('web_geometry_set_lod_error'));
    assert.ok(names.includes('web_geometry_set_temporal_antialiasing'));
    assert.ok(names.includes('web_geometry_add_light'));
    assert.ok(names.includes('web_geometry_remove_light'));
    assert.ok(names.includes('web_geometry_set_diagnostic'));
  });

  it('formats tools correctly for OpenAI Function Calling', () => {
    const openaiTools = getWebGeometryTools('openai');
    assert.equal(openaiTools.length, WEB_GEOMETRY_RUNTIME_TOOLS.length);
    for (const tool of openaiTools) {
      assert.equal(tool.type, 'function');
      assert.ok(tool.function.name);
      assert.ok(tool.function.description);
      assert.equal(tool.function.parameters.type, 'object');
    }
  });

  it('formats tools correctly for Anthropic Tool Use', () => {
    const anthropicTools = getWebGeometryTools('anthropic');
    assert.equal(anthropicTools.length, WEB_GEOMETRY_RUNTIME_TOOLS.length);
    for (const tool of anthropicTools) {
      assert.ok(tool.name);
      assert.ok(tool.description);
      assert.equal(tool.input_schema.type, 'object');
    }
  });

  it('formats tools correctly for Gemini Function Declarations', () => {
    const geminiTools = getWebGeometryTools('gemini');
    assert.equal(geminiTools.length, WEB_GEOMETRY_RUNTIME_TOOLS.length);
    for (const tool of geminiTools) {
      assert.ok(tool.name);
      assert.ok(tool.description);
      assert.equal(tool.parameters.type, 'object');
    }
  });

  it('formats tools correctly for Model Context Protocol (MCP)', () => {
    const mcpTools = getWebGeometryTools('mcp');
    assert.equal(mcpTools.length, WEB_GEOMETRY_RUNTIME_TOOLS.length);
    for (const tool of mcpTools) {
      assert.ok(tool.name);
      assert.ok(tool.description);
      assert.equal(tool.inputSchema.type, 'object');
    }
  });

  it('converts individual tools directly with converter helpers', () => {
    const sampleTool = WEB_GEOMETRY_RUNTIME_TOOLS[0];
    assert.equal(toOpenAiTool(sampleTool).function.name, sampleTool.name);
    assert.equal(toAnthropicTool(sampleTool).name, sampleTool.name);
    assert.equal(toGeminiTool(sampleTool).name, sampleTool.name);
    assert.equal(toMcpTool(sampleTool).name, sampleTool.name);
  });

  it('generates an expert system prompt guide', () => {
    const prompt = getWebGeometryLlmPrompt();
    assert.ok(prompt.includes('WebGeometry'));
    assert.ok(prompt.includes('Nanite'));
    assert.ok(prompt.includes('TAA'));
    assert.ok(prompt.includes('Lumen'));
    assert.ok(prompt.includes('pixelError'));
  });
});
