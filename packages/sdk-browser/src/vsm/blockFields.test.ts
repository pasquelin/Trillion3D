// Every field the host writes into the shadow maps' uniform block and projection record is read by
// a composed shader: a field no shader reads is a word written for nothing each frame, and the
// block or the record carries only what some pass needs. Pads (a leading underscore) are the
// layout's own. A record's raw field is read by the decode (`vsmUnpackProjection`) or straight
// from the record; what the decode makes of it is read where a shader takes it from a decoded
// record, past the decode itself.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ENGINE_SHADERS } from '../gpu/core/engineShaders.fixture.ts';
import { directShadowWgsl } from '../lighting/direct/shadowWgsl.ts';
import { VSM_PROJECTION_DATA_WGSL } from './projectionDataWgsl.ts';
import { VSM_UNIFORMS_WGSL } from './uniforms.ts';

/** The shaders that read the maps: every engine shader and the direct shadow read as each pass
 *  composes it. */
const COMPOSED: Record<string, string> = {
  ...ENGINE_SHADERS,
  'direct read, blended': directShadowWgsl(null, 18),
  'direct read, opaque resolve': directShadowWgsl(14, 25),
  'direct read, traced': directShadowWgsl(null, 18, undefined, true),
};

/** The field names of struct `name` in `text`, pads left out. */
function fieldsOf(text: string, name: string) {
  const body = new RegExp(`struct ${name}\\{([^}]*)\\}`).exec(text);
  assert.ok(body, `struct ${name}`);
  return [...body[1].matchAll(/(\w+):/g)].map((m) => m[1]).filter((f) => !f.startsWith('_'));
}

/** `text` without the function `name` (the decode, which reads every field): from its name to the
 *  brace that balances its body's opening one. */
function without(text: string, name: string) {
  const at = text.indexOf(`fn ${name}(`);
  if (at < 0) return text;
  let depth = 0;
  for (let end = text.indexOf('{', at); end < text.length; end++) {
    if (text[end] === '{') depth++;
    else if (text[end] === '}' && --depth === 0) return text.slice(0, at) + text.slice(end + 1);
  }
  return text.slice(0, at);
}

/** The fields of `fields` that no text of `texts` reads as `<receiver>.field` (`receivers` the
 *  names a shader holds the block or a record under, `.field` alone when empty). */
function unread(fields: string[], texts: string[], receivers: string[]) {
  const prefix = receivers.length ? `(?:${receivers.join('|')})` : '';
  return fields.filter((field) => {
    const read = new RegExp(`${prefix}\\.${field}\\b`);
    return !texts.some((text) => read.test(text));
  });
}

const texts = () => Object.values(COMPOSED).map((t) => without(t, 'vsmUnpackProjection'));
const UNIFORM_FIELDS = fieldsOf(VSM_UNIFORMS_WGSL, 'VsmUniforms'),
  RAW_FIELDS = fieldsOf(VSM_PROJECTION_DATA_WGSL, 'VsmProjectionRecord'),
  RECORD_FIELDS = fieldsOf(VSM_PROJECTION_DATA_WGSL, 'VsmProjectionData').filter(
    (f) => f !== 'handle',
  );

test('every field of the uniform block and of the projection record is read by a shader', () => {
  assert.ok(Object.keys(COMPOSED).length >= 150, 'every engine shader is checked');
  assert.ok(UNIFORM_FIELDS.length >= 30 && RECORD_FIELDS.length >= 15 && RAW_FIELDS.length >= 15);
  assert.deepEqual(unread(UNIFORM_FIELDS, texts(), ['vsm']), []);
  assert.deepEqual(unread(RAW_FIELDS, Object.values(COMPOSED), []), []);
  assert.deepEqual(unread(RECORD_FIELDS, texts(), []), []);
});

/** The passes' own parameter blocks and per-item records, as the composed shaders declare them. */
const PASS_STRUCTS = [
  'VsmMarkingParams',
  'VsmPmParams',
  'VsmProjectionView',
  'VsmProjectionLight',
  'VsmInvalidationParams',
  'VsmInvalidationInstance',
  'VsmRenderParams',
  'VsmMapWalkParams',
];

test("every field of the passes' parameter blocks and per-item records is read by a shader", () => {
  const all = Object.values(COMPOSED);
  for (const name of PASS_STRUCTS) {
    const text = all.find((t) => t.includes(`struct ${name}{`));
    assert.ok(text, `a composed shader declares ${name}`);
    const fields = fieldsOf(text, name).filter((f) => f !== 'pad');
    assert.deepEqual(unread(fields, all, []), [], name);
  }
});

test('the guard names a field no shader reads, in the block and in the record', () => {
  assert.deepEqual(unread([...UNIFORM_FIELDS, 'unreadField'], texts(), ['vsm']), ['unreadField']);
  assert.deepEqual(unread([...RECORD_FIELDS, 'unreadField'], texts(), []), ['unreadField']);
  // A field the decode alone reads is unread: the decode is left out.
  const decoded = 'fn vsmUnpackProjection(raw:R)->R{var r:R;r.onlyHere=raw.onlyHere;return r;}';
  assert.deepEqual(unread(['onlyHere'], [without(decoded, 'vsmUnpackProjection')], []), [
    'onlyHere',
  ]);
});
