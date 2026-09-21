import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { SIMPLIFICATIONS, isSimplification } from './contracts.ts';
import { COMPILER_OPTIONS_SCHEMA } from '../sdk-core/llm/compilerOptionsSchema.ts';

// ONE LIST OF STRATEGIES, THREE READERS.
//
// The compiler refuses a `simplification` its `DagStrategy::NAMES` does not carry; the Node
// CLI refuses it before the compiler sees it; the LLM schema offers it. A name added to one
// of them and not the others is an option a host is told exists and the compiler refuses, or
// the reverse. This test reads the Rust list at source and holds the two TypeScript copies to it.

const dagSource = new URL('../asset-compiler-rust/src/dag.rs', import.meta.url);

test('the strategy names of the compiler, the Node contract and the LLM schema are one list', async () => {
  const rust = await readFile(dagSource, 'utf8');
  const names = [
    ...rust.match(/pub const NAMES: \[&str; \d+\] = \[([^\]]+)\]/)[1].matchAll(/"([^"]+)"/g),
  ].map((m) => m[1]);
  assert.deepEqual([...SIMPLIFICATIONS], names);
  assert.deepEqual(COMPILER_OPTIONS_SCHEMA.properties.simplification.enum, names);
  for (const name of names) assert.ok(isSimplification(name), name);
  assert.equal(isSimplification('qem'), false);
});
