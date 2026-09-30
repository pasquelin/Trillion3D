import assert from 'node:assert/strict';
import test from 'node:test';
import { Ajv } from 'ajv';
import { TRILLION3D_SYSTEM_PROMPT, getTrillion3dLlmPrompt } from './systemPrompt.ts';
import { EXPLORER_OPTIONS_SCHEMA } from './explorerOptionsSchema.ts';
import { TRILLION3D_RUNTIME_TOOLS } from './runtimeToolsSchema.ts';

const isValue = (text: string) => {
  try {
    JSON.parse(text);
    return true;
  } catch {
    return false;
  }
};

test('the prompt names only options and tools that exist, with values the options accept', () => {
  assert.equal(getTrillion3dLlmPrompt(), TRILLION3D_SYSTEM_PROMPT);
  const validate = new Ajv().compile(EXPLORER_OPTIONS_SCHEMA);
  const tools = new Set(TRILLION3D_RUNTIME_TOOLS.map((tool) => tool.name));
  // Each code span is an option (`pixelError`), an option set to a value (`pixelError = 0`), a
  // bare value (`false`) or a tool name.
  const spans = [...TRILLION3D_SYSTEM_PROMPT.matchAll(/`([^`]+)`/g)].map((match) => match[1]);
  const named = spans.filter((span) => !isValue(span));
  assert.ok(named.length > 0);
  for (const span of named) {
    const [, name, value] = /^(\w+)(?:\s*[:=]\s*(.+))?$/.exec(span) ?? [];
    assert.ok(name, span);
    if (tools.has(name)) continue;
    assert.ok(name in EXPLORER_OPTIONS_SCHEMA.properties, span);
    if (value !== undefined)
      assert.equal(
        validate({ manifestUrl: 'manifest.json', [name]: JSON.parse(value) }),
        true,
        span,
      );
  }
});
