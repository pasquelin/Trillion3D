// #685: the GPU timing names a timed pass by its label, or else by the method that began it
// (`encoder.ts`), and a ranking cannot attribute a span named `beginRenderPass`. Every pass the
// engine begins is read here from the source and must carry a label: a new pass without one fails
// this test, never the measurer's ranking.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const source = new URL('../../', import.meta.url);
/** The timing encoder only forwards the descriptor its caller handed it. */
const FORWARDER = 'gpu/timing/encoder.ts';
/** A descriptor its caller receives ready-made: the module that builds it. */
const BUILT_IN: Record<string, string> = {
  'webgpu/pages/render/encodeShadowPass.ts': 'gpu/shadow/layers.ts',
  'webgpu/pages/render/encodeTransmittance.ts': 'gpu/shadow/layers.ts',
};

/** The end of the string or comment starting at `at`, or `at` when none starts there. */
function skipped(text: string, at: number) {
  const char = text[at]!,
    end = (index: number) => (index < 0 ? text.length : index);
  if (char === "'" || char === '"' || char === '`') return end(text.indexOf(char, at + 1));
  if (text.startsWith('//', at)) return end(text.indexOf('\n', at));
  if (text.startsWith('/*', at)) return end(text.indexOf('*/', at)) + 1;
  return at;
}

/** The text from `open`, just past an opening bracket, to its matching close. */
function enclosed(text: string, open: number) {
  let depth = 1;
  for (let at = open; at < text.length; at++) {
    at = skipped(text, at);
    if ('([{'.includes(text[at]!)) depth++;
    else if (')]}'.includes(text[at]!) && --depth === 0) return text.slice(open, at);
  }
  throw new Error('UNBALANCED');
}

/** Whether an object literal's own keys, not a nested one's, hold `label`. */
function hasOwnLabel(literal: string) {
  let own = '';
  for (let at = 1; at < literal.length; at++) {
    const next = skipped(literal, at);
    if (next !== at) at = next;
    else if ('([{'.includes(literal[at]!)) at += enclosed(literal, at + 1).length + 1;
    else own += literal[at];
  }
  return /(^|[,{\s])label\s*([:,}]|$)/.test(own);
}

/** Every object literal of `text` that `pattern` leads to (its last group an opening brace). */
const literalsAt = (text: string, pattern: RegExp) =>
  [...text.matchAll(pattern)].map((m) => '{' + enclosed(text, m.index + m[0].length) + '}');

/** Why the descriptor `argument` of a pass begun in `file` may carry no label, or `null`. */
function unlabelled(file: string, text: string, argument: string) {
  const trimmed = argument.trim();
  if (!trimmed) return 'no descriptor';
  if (trimmed.startsWith('{')) return hasOwnLabel(trimmed) ? null : 'a literal without label';
  // `hizPass!`, `passes[at]`, `layer.passes[at]`: the name of the descriptor or of its list.
  const name = trimmed.replace(/\[[^\]]*\]/g, '').match(/(\w+)\W*$/)![1];
  let literals = literalsAt(text, new RegExp(`\\b${name}\\b\\s*(?::[^=;{]*)?=(?!=)\\s*\\{`, 'g'));
  if (!literals.length && BUILT_IN[file]) {
    const builder = readFileSync(new URL(BUILT_IN[file], source), 'utf8');
    literals = literalsAt(builder, /GPU(?:Render|Compute)PassDescriptor\s*=>\s*\(\{/g);
  }
  if (!literals.length) return `\`${name}\` is not a literal of this module`;
  return literals.every(hasOwnLabel) ? null : `\`${name}\` is a literal without label`;
}

test('the source scan reads what a label is, and what it is not', () => {
  assert.equal(hasOwnLabel('{ label: PASS, colorAttachments: [] }'), true);
  assert.equal(hasOwnLabel('{ label }'), true);
  assert.equal(hasOwnLabel("{ colorAttachments: [{ view, label: 'x' }] }"), false);
  assert.equal(hasOwnLabel('{ labelled: true }'), false);
  assert.equal(unlabelled('a.ts', 'const d = { label: X };', 'd!'), null);
  assert.equal(unlabelled('a.ts', 'const d = { size: 1 };', 'd'), '`d` is a literal without label');
  assert.equal(unlabelled('a.ts', '', ''), 'no descriptor');
});

test('every render and compute pass the engine begins carries its own label', () => {
  const found: string[] = [],
    missing: string[] = [];
  for (const file of readdirSync(source, { recursive: true, encoding: 'utf8' })) {
    if (!file.endsWith('.ts') || /\.(test|fixture)\.ts$/.test(file) || file === FORWARDER) continue;
    const text = readFileSync(new URL(file, source), 'utf8');
    for (const call of text.matchAll(/\.begin(?:Render|Compute)Pass\(/g)) {
      const at = `${file}:${text.slice(0, call.index).split('\n').length}`;
      found.push(at);
      const why = unlabelled(file, text, enclosed(text, call.index + call[0].length));
      if (why) missing.push(`${at}: ${why}`);
    }
  }
  assert.ok(found.length >= 40, `the scan reached the engine's passes (${found.length})`);
  assert.deepEqual(missing, [], 'a timed pass without label is ranked as `beginRenderPass`');
});
