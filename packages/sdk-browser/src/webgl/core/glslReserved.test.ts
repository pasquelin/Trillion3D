// A WebGL2 program that names a word GLSL ES 3.00 reserves compiles on no device (`half` broke the
// cluster program once). This gate reads, before any browser does, every program text the WebGL2
// path writes — each `#version 300 es` text as its file writes it, each GLSL text a module exports,
// and the programs composed of them — with the one reserved-word list (`glslReservedNames`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import '../../impostor/lent.fixture.ts';
import { glslReservedNames } from '../../gpu/core/wgslNames.fixture.ts';
import { CLUSTER_FRAGMENT, CLUSTER_LINEAR_FRAGMENT, CLUSTER_VERTEX } from '../cluster/shaders.ts';
import { cardFragment, cardVertex } from '../impostor/cardGlsl.ts';
import { resampleFragment } from './resampleGlsl.ts';
import { particleVertexGlsl } from '../particles/webglParticleGlsl.ts';

const source = new URL('../../', import.meta.url);
const files = readdirSync(source, { recursive: true, encoding: 'utf8' }).filter(
  (file) => file.endsWith('.ts') && !/\.(test|fixture)\.ts$/.test(file),
);
const read = (file: string) => readFileSync(new URL(file, source), 'utf8');

/** Every text from `#version 300 es` to the backtick that closes it, each `${…}` left out: what
 *  the file itself writes of a program. */
function programTexts(text: string) {
  const texts: string[] = [];
  for (
    let at = text.indexOf('#version 300 es');
    at >= 0;
    at = text.indexOf('#version 300 es', at)
  ) {
    let body = '';
    for (; at < text.length && text[at] !== '`'; at++) {
      if (text[at] !== '$' || text[at + 1] !== '{') {
        body += text[at];
        continue;
      }
      for (let depth = 0; ; at++) {
        if (text[at] === '{') depth++;
        else if (text[at] === '}' && --depth === 0) break;
      }
      body += ' ';
    }
    texts.push(body);
  }
  return texts;
}

/** The reserved words of each named text, the clean ones left out. */
const offending = (texts: [string, string][]) =>
  Object.fromEntries(
    texts
      .map(([name, text]) => [name, glslReservedNames(text)])
      .filter(([, names]) => names.length),
  );

test('every WebGL2 program text, as its file writes it, names no word GLSL ES 3.00 reserves', () => {
  const texts = files.flatMap((file) =>
    programTexts(read(file)).map((text, k) => [`${file}#${k}`, text] as [string, string]),
  );
  assert.ok(texts.length >= 15, `${texts.length} program texts`);
  assert.deepEqual(offending(texts), {});
});

test('every exported GLSL text, and every program the WebGL2 path composes of them, names none', async () => {
  const texts: [string, string][] = [];
  for (const file of files) {
    if (!/export (?:const|function) \w*(?:GLSL|Glsl)\b/.test(read(file))) continue;
    const module = (await import(new URL(file, source).href)) as Record<string, unknown>;
    for (const [name, value] of Object.entries(module))
      if (/GLSL|Glsl/.test(name) && typeof value === 'string')
        texts.push([`${file}:${name}`, value]);
  }
  texts.push(
    ['CLUSTER_VERTEX', CLUSTER_VERTEX],
    ['CLUSTER_FRAGMENT', CLUSTER_FRAGMENT],
    ['CLUSTER_LINEAR_FRAGMENT', CLUSTER_LINEAR_FRAGMENT],
    ['cardVertex', cardVertex()],
    ['cardFragment', cardFragment(false)],
    ['cardFragment linear', cardFragment(true)],
    ['resampleFragment', resampleFragment(false)],
    ['resampleFragment untoned', resampleFragment(true)],
    ['particleVertexGlsl', particleVertexGlsl(1024)],
  );
  assert.deepEqual(offending(texts), {});
});

test('every module that compiles a WebGL2 program is one the gate reads', () => {
  // A program compiled from a module whose texts the two sweeps above never read would escape them.
  const unread = files.filter((file) => {
    const text = read(file);
    return (
      /createWebglProgram\(gl/.test(text) &&
      !text.includes('#version 300 es') &&
      !/import \{[^}]*\b(?:\w*GLSL\w*|\w+Glsl|FULLSCREEN_VERTEX|CLUSTER_\w+|card\w+|resampleFragment)\b/.test(
        text,
      )
    );
  });
  assert.deepEqual(unread, []);
});

test('the gate finds a reserved word in a program text and in an exported text', () => {
  assert.deepEqual(
    programTexts('const A = `#version 300 es\nfloat half=${B};`;').flatMap(glslReservedNames),
    ['half'],
  );
  assert.deepEqual(glslReservedNames('vec4 sample(vec2 uv){return vec4(uv,0.,1.);}'), ['sample']);
});
