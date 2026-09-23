/**
 * Standardized format for LLM tool definitions.
 */
export type LlmToolFormat = 'openai' | 'anthropic' | 'gemini' | 'mcp' | 'json-schema';

/**
 * Simplified JSON Schema for LLM function parameters.
 */
export interface JsonSchemaProperty {
  /** The value's kind. */
  type: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object';
  /** What it means. */
  description: string;
  /** The allowed values. */
  enum?: readonly (string | number)[];
  /** The value when none is given. */
  default?: string | number | boolean;
  /** Smallest value. */
  minimum?: number;
  /** Largest value. */
  maximum?: number;
  /** The shape of each item. */
  items?: JsonSchemaProperty;
  /** The shape of each field. */
  properties?: Record<string, JsonSchemaProperty>;
  /** Fields that must be given. */
  required?: readonly string[];
}

/** The shape of a tool's whole argument object. */
export interface JsonSchemaObject {
  /** Always `'object'`. */
  type: 'object';
  /** What it means. */
  description?: string;
  /** Its fields. */
  properties: Record<string, JsonSchemaProperty>;
  /** Fields that must be given. */
  required?: readonly string[];
  /** Whether other fields are allowed. */
  additionalProperties?: boolean;
}

/**
 * Generic trillion3D tool definition for LLMs.
 */
export interface Trillion3DTool {
  /** The tool's name. */
  name: string;
  /** What it does. */
  description: string;
  /** Its arguments. */
  parameters: JsonSchemaObject;
}

/** A tool in the form OpenAI's API reads. */
export interface OpenAiToolDefinition {
  /** Always `'function'`. */
  type: 'function';
  /** The tool itself. */
  function: {
    name: string;
    description: string;
    parameters: JsonSchemaObject;
  };
}

/** A tool in the form Anthropic's API reads. */
export interface AnthropicToolDefinition {
  /** The tool's name. */
  name: string;
  /** What it does. */
  description: string;
  /** Its arguments. */
  input_schema: JsonSchemaObject;
}

/** A tool in the form Gemini's API reads. */
export interface GeminiFunctionDeclaration {
  /** The tool's name. */
  name: string;
  /** What it does. */
  description: string;
  /** Its arguments. */
  parameters: JsonSchemaObject;
}

/** A tool in the form the Model Context Protocol reads. */
export interface McpToolDefinition {
  /** The tool's name. */
  name: string;
  /** What it does. */
  description: string;
  /** Its arguments. */
  inputSchema: JsonSchemaObject;
}
