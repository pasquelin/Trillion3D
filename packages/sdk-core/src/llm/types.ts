/**
 * Standardized format for LLM tool definitions.
 */
export type LlmToolFormat = 'openai' | 'anthropic' | 'gemini' | 'mcp' | 'json-schema'

/**
 * Simplified JSON Schema for LLM function parameters.
 */
export interface JsonSchemaProperty {
  /** The value's kind; left out where `anyOf` names the kinds it may take. */
  type?: 'string' | 'number' | 'integer' | 'boolean' | 'array' | 'object'
  /** The shapes the value may take, one of them. */
  anyOf?: readonly JsonSchemaProperty[]
  /** What it means. */
  description: string
  /** The allowed values. */
  enum?: readonly (string | number)[]
  /** The value when none is given. */
  default?: string | number | boolean
  /** Smallest value. */
  minimum?: number
  /** The value must be above this one. */
  exclusiveMinimum?: number
  /** Largest value. */
  maximum?: number
  /** The shape of each item. */
  items?: JsonSchemaProperty
  /** Fewest and most items of an array. */
  minItems?: number
  maxItems?: number
  /** The shape of each field. */
  properties?: Record<string, JsonSchemaProperty>
  /** Fields that must be given. */
  required?: readonly string[]
}

/** The shape of a tool's whole argument object. */
export interface JsonSchemaObject {
  /** Always `'object'`. */
  type: 'object'
  /** What it means. */
  description?: string
  /** Its fields. */
  properties: Record<string, JsonSchemaProperty>
  /** Fields that must be given. */
  required?: readonly string[]
  /** Whether other fields are allowed. */
  additionalProperties?: boolean
}

/**
 * Generic Trillion3D tool definition for LLMs.
 */
export interface Trillion3dTool {
  /** The tool's name. */
  name: string
  /** What it does. */
  description: string
  /** Its arguments. */
  parameters: JsonSchemaObject
}

/** A tool in the form OpenAI's API reads. */
export interface OpenAiToolDefinition {
  /** Always `'function'`. */
  type: 'function'
  /** The tool itself. */
  function: {
    name: string
    description: string
    parameters: JsonSchemaObject
  }
}

/** A tool in the form Anthropic's API reads. */
export interface AnthropicToolDefinition {
  /** The tool's name. */
  name: string
  /** What it does. */
  description: string
  /** Its arguments. */
  input_schema: JsonSchemaObject
}

/** A tool in the form Gemini's API reads: the generic tool's fields. */
export type GeminiFunctionDeclaration = Trillion3dTool

/** A tool in the form the Model Context Protocol reads. */
export interface McpToolDefinition {
  /** The tool's name. */
  name: string
  /** What it does. */
  description: string
  /** Its arguments. */
  inputSchema: JsonSchemaObject
}
