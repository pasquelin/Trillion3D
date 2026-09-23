import type {
  AnthropicToolDefinition,
  GeminiFunctionDeclaration,
  LlmToolFormat,
  McpToolDefinition,
  OpenAiToolDefinition,
  Trillion3DTool,
} from './types.ts';
import { TRILLION3D_RUNTIME_TOOLS } from './runtimeToolsSchema.ts';

/**
 * Converts a generic trillion3D tool into OpenAI Function Calling format.
 */
export function toOpenAiTool(tool: Trillion3DTool): OpenAiToolDefinition {
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
 * Converts a generic trillion3D tool into Anthropic Tool Use format.
 */
export function toAnthropicTool(tool: Trillion3DTool): AnthropicToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    input_schema: tool.parameters,
  };
}

/**
 * Converts a generic trillion3D tool into Google Gemini Function Declaration format.
 */
export function toGeminiTool(tool: Trillion3DTool): GeminiFunctionDeclaration {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters,
  };
}

/**
 * Converts a generic trillion3D tool into Model Context Protocol (MCP) format.
 */
export function toMcpTool(tool: Trillion3DTool): McpToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    inputSchema: tool.parameters,
  };
}

/**
 * Returns the complete array of trillion3D tool definitions formatted for the target LLM provider.
 *
 * @param format Target format ('openai' | 'anthropic' | 'gemini' | 'mcp' | 'json-schema'). Default: 'openai'.
 */
export function getTrillion3DTools(format: 'openai'): OpenAiToolDefinition[];
export function getTrillion3DTools(format: 'anthropic'): AnthropicToolDefinition[];
export function getTrillion3DTools(format: 'gemini'): GeminiFunctionDeclaration[];
export function getTrillion3DTools(format: 'mcp'): McpToolDefinition[];
export function getTrillion3DTools(format: 'json-schema'): Trillion3DTool[];
export function getTrillion3DTools(format?: LlmToolFormat): unknown[];
export function getTrillion3DTools(format: LlmToolFormat = 'openai'): unknown[] {
  switch (format) {
    case 'openai':
      return TRILLION3D_RUNTIME_TOOLS.map(toOpenAiTool);
    case 'anthropic':
      return TRILLION3D_RUNTIME_TOOLS.map(toAnthropicTool);
    case 'gemini':
      return TRILLION3D_RUNTIME_TOOLS.map(toGeminiTool);
    case 'mcp':
      return TRILLION3D_RUNTIME_TOOLS.map(toMcpTool);
    case 'json-schema':
    default:
      return [...TRILLION3D_RUNTIME_TOOLS];
  }
}
