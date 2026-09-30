// #685: the GPU timing names a timed pass by its label, or else by the method that began it
// (`encoder.ts`), and a ranking cannot attribute a span named `beginRenderPass`. Every pass the
// engine begins is read here from the source: its descriptor, inline or declared before the call
// in the same module, opens with its label. A new pass without one fails this test, never the
// ranking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const source = new URL('../../', import.meta.url);
/** The timing encoder only forwards the descriptor its caller handed it. */
const FORWARDER = 'gpu/timing/encoder.ts';
/** A descriptor opens with its label: `{ label: …, … }`, whatever the spacing. */
const LABEL_FIRST = String.raw`\s*\{\s*label\b`;
/** The modules that begin the shadow layers' descriptors, as `passes[at]`, built by `layerPasses`. */
const LAYER_CALLERS = new Set([
  'webgpu/pages/render/encodeShadowPass.ts',
  'webgpu/pages/render/encodeTransmittance.ts',
  'webgpu/shadow/freshPass.ts',
]);
const LAYERS_LABELLED = new RegExp(`PassDescriptor => \\(${LABEL_FIRST}`).test(
  readFileSync(new URL('gpu/shadow/layers.ts', source), 'utf8'),
);

/** Whether the descriptor `argument` (`surfacePass`, `hizPass`, `layer.passes`) begun at `at` has
 *  a label: its last assignment before the call opens with one. */
function labelled(file: string, text: string, argument: string, at: number) {
  const name = argument.split('.').pop()!;
  if (name === 'passes' && LAYER_CALLERS.has(file)) return LAYERS_LABELLED;
  if (!name) return false;
  const assigned = new RegExp(String.raw`\b${name}\b(?:\s*:[^=;{\n]*)?\s*=(?![=>])`, 'g');
  const last = [...text.slice(0, at).matchAll(assigned)].at(-1);
  return !!last && new RegExp(`^${LABEL_FIRST}`).test(text.slice(last.index + last[0].length));
}

test('every render and compute pass the engine begins opens its descriptor with a label', () => {
  const found: string[] = [],
    missing: string[] = [];
  const call = new RegExp(
    String.raw`\.begin(?:Render|Compute)Pass\((?:${LABEL_FIRST}|([\w.]*))`,
    'g',
  );
  for (const entry of readdirSync(source, { recursive: true, encoding: 'utf8' })) {
    const file = entry.replaceAll('\\', '/');
    if (!file.endsWith('.ts') || /\.(test|fixture)\.ts$/.test(file) || file === FORWARDER) continue;
    const text = readFileSync(new URL(file, source), 'utf8');
    for (const match of text.matchAll(call)) {
      const at = `${file}:${text.slice(0, match.index).split('\n').length}`;
      found.push(at);
      if (match[1] !== undefined && !labelled(file, text, match[1], match.index)) missing.push(at);
    }
  }
  assert.ok(found.length >= 40, `the scan reached the engine's passes (${found.length})`);
  assert.deepEqual(missing, [], 'a timed pass without label is ranked as `beginRenderPass`');
});
