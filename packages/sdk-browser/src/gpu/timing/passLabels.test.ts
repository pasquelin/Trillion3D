// #685: the GPU timing names a timed pass by its label, or else by the method that began it
// (`encoder.ts`), and a ranking cannot attribute a span named `beginRenderPass`. Every pass the
// engine begins is read here from the source: its descriptor, inline or declared in the same
// module, opens with its label. A new pass without one fails this test, never the ranking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const source = new URL('../../', import.meta.url);
/** The timing encoder only forwards the descriptor its caller handed it. */
const FORWARDER = 'gpu/timing/encoder.ts';
/** A descriptor opens with its label: `{ label: …, … }`, whatever the spacing. */
const LABEL_FIRST = String.raw`\s*\{\s*label\b`;
/** The shadow layers' descriptors, begun as `passes[at]`, are built by `layerPasses`. */
const LAYERS = readFileSync(new URL('gpu/shadow/layers.ts', source), 'utf8');

/** Whether the descriptor `argument` (`surfacePass`, `hizPass`, `layer.passes`) has a label. */
function labelled(text: string, argument: string) {
  const name = argument.split('.').pop()!;
  if (name === 'passes') return new RegExp(`PassDescriptor => \\(${LABEL_FIRST}`).test(LAYERS);
  return (
    !!name && new RegExp(String.raw`\b${name}\b(?:\s*:[^=;{\n]*)?\s*=${LABEL_FIRST}`).test(text)
  );
}

test('every render and compute pass the engine begins opens its descriptor with a label', () => {
  const found: string[] = [],
    missing: string[] = [];
  const call = new RegExp(
    String.raw`\.begin(?:Render|Compute)Pass\((?:${LABEL_FIRST}|([\w.]*))`,
    'g',
  );
  for (const file of readdirSync(source, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.ts') || /\.(test|fixture)\.ts$/.test(file) || file === FORWARDER) continue;
    const text = readFileSync(new URL(file, source), 'utf8');
    for (const match of text.matchAll(call)) {
      const at = `${file}:${text.slice(0, match.index).split('\n').length}`;
      found.push(at);
      if (match[1] !== undefined && !labelled(text, match[1])) missing.push(at);
    }
  }
  assert.ok(found.length >= 40, `the scan reached the engine's passes (${found.length})`);
  assert.deepEqual(missing, [], 'a timed pass without label is ranked as `beginRenderPass`');
});
