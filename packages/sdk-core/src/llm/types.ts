/**
 * Standardized format for LLM tool definitions.
 */
export type LlmToolFormat = 'openai' | 'anthropic' | 'gemini' | 'mcp' | 'json-schema';

/**
 * Simplified JSON Schema for LLM function parameters.
 */
export interface JsonSchemaProperty {
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  description: string;
  enum?: readonly (string | number)[];
  default?: string | number | boolean;
  minimum?: number;
  maximum?: number;
  items?: JsonSchemaProperty;
  properties?: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
}

export interface JsonSchemaObject {
  type: 'object';
  description?: string;
  properties: Record<string, JsonSchemaProperty>;
  required?: readonly string[];
  additionalProperties?: boolean;
}

/**
 * Generic WebGeometry tool definition for LLMs.
 */
export interface WebGeometryTool {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
}

/**
 * Typed tool definitions per LLM provider.
 */
export interface OpenAiToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchemaObject;
  };
}

export interface AnthropicToolDefinition {
  name: string;
  description: string;
  input_schema: JsonSchemaObject;
}

export interface GeminiFunctionDeclaration {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: JsonSchemaObject;
}
