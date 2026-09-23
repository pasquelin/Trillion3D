import type {
  AnthropicToolDefinition,
  GeminiFunctionDeclaration,
  LlmToolFormat,
  McpToolDefinition,
  OpenAiToolDefinition,
  WebGeometryTool,
} from './types.ts';
import { WEB_GEOMETRY_RUNTIME_TOOLS } from './runtimeToolsSchema.ts';

/**
 * Converts a generic WebGeometry tool into OpenAI Function Calling format.
 */
export function toOpenAiTool(tool: WebGeometryTool): OpenAiToolDefinition {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/**
 * Converts a generic WebGeometry tool into Anthropic Tool Use format.
 */
export function toAnthropicTool(tool: WebGeometryTool): AnthropicToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

/**
 * Converts a generic WebGeometry tool into Google Gemini Function Declaration format.
 */
export function toGeminiTool(tool: WebGeometryTool): GeminiFunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

/**
 * Converts a generic WebGeometry tool into Model Context Protocol (MCP) format.
 */
export function toMcpTool(tool: WebGeometryTool): McpToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  };
}

/**
 * Returns the complete array of WebGeometry tool definitions formatted for the target LLM provider.
 *
 * @param format Target format ('openai' | 'anthropic' | 'gemini' | 'mcp' | 'json-schema'). Default: 'openai'.
 */
export function getWebGeometryTools(format: 'openai'): OpenAiToolDefinition[];
export function getWebGeometryTools(format: 'anthropic'): AnthropicToolDefinition[];
export function getWebGeometryTools(format: 'gemini'): GeminiFunctionDeclaration[];
export function getWebGeometryTools(format: 'mcp'): McpToolDefinition[];
export function getWebGeometryTools(format: 'json-schema'): WebGeometryTool[];
export function getWebGeometryTools(format?: LlmToolFormat): unknown[];
export function getWebGeometryTools(format: LlmToolFormat = 'openai'): unknown[] {
  switch (format) {
    case 'openai':
      return WEB_GEOMETRY_RUNTIME_TOOLS.map(toOpenAiTool);
    case 'anthropic':
      return WEB_GEOMETRY_RUNTIME_TOOLS.map(toAnthropicTool);
    case 'gemini':
      return WEB_GEOMETRY_RUNTIME_TOOLS.map(toGeminiTool);
    case 'mcp':
      return WEB_GEOMETRY_RUNTIME_TOOLS.map(toMcpTool);
    case 'json-schema':
    default:
      return [...WEB_GEOMETRY_RUNTIME_TOOLS];
  }
}
