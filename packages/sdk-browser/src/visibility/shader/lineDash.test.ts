// #359: a dashed line draws `dashSize`, then leaves `gapSize` empty, along the line, as the
// reference's `LineDashedMaterial`. The real text of both shaders and its CPU twin decide it, and
// every path that draws a line reads that one formula.
import test from 'node:test';
import assert from 'node:assert/strict';
import { LINE_DASH_GLSL, LINE_DASH_WGSL, lineDash } from './lineWgsl.ts';
import { runLineText } from './lineClip.fixture.ts';
import { MASK_KEEP_WGSL, PAGE_INFO_STRUCT_WGSL } from './pageWgsl.ts';
import { PAGE_GEOMETRY_WGSL } from './pageGeometryWgsl.ts';
import { VIS_SHADER } from './visWgsl.ts';
import { rasterSource } from '../../gpu/raster/shader.ts';
import { BLEND_SHADER } from '../../webgpu/blend/shader.ts';
import { BLEND_ITEM_WGSL } from '../../webgpu/blend/items.ts';
import { CLUSTER_FRAGMENT } from '../../webgl/cluster/shaders.ts';
import { SHADER as FALLBACK_SHADER } from '../../webgpu/pages/prepare/shaders.ts';
import { ROW_DASH_WORD } from '../../webgpu/row/pageRow.ts';

type Dash = (at: number, dash: number[]) => boolean;
const DASHES: Record<string, Dash> = {
  wgsl: runLineText<boolean>(LINE_DASH_WGSL),
  glsl: runLineText<boolean>(LINE_DASH_GLSL),
  cpu: (at, [dashSize, gapSize]) => lineDash(at, dashSize, gapSize),
};

/** The dashes drawn over `[0, length)`, read every millimetre: `[start, end]` of each. */
function dashes(run: Dash, length: number, dash: number[]) {
  const runs: number[][] = [];
  for (let mm = 0; mm < length * 1000; mm++) {
    const at = mm / 1000;
    if (!run(at, dash)) continue;
    const last = runs.at(-1);
    if (last && Math.abs(last[1] - (at - 0.001)) < 1e-9) last[1] = at;
    else runs.push([at, at]);
  }
  return runs;
}

// The issue's fixture: a 4 m line, dash 0.3, gap 0.2, draws eight dashes, each 0.3 long, one
// every 0.5 from the first vertex.
for (const [language, run] of Object.entries(DASHES))
  test(`${language}: a 4 m line of dash 0.3 and gap 0.2 draws eight dashes at their distances`, () => {
    const runs = dashes(run, 4, [0.3, 0.2]);
    assert.equal(runs.length, 8);
    runs.forEach(([start, end], k) => {
      assert.ok(Math.abs(start - k * 0.5) < 1.5e-3, `dash ${k} starts at ${start}`);
      assert.ok(Math.abs(end - (k * 0.5 + 0.3)) < 1.5e-3, `dash ${k} ends at ${end}`);
    });
    for (const at of [0.1, 0.29, 3.6]) assert.equal(run(at, [0.3, 0.2]), true, `on dash ${at}`);
    for (const at of [0.35, 0.45, 3.85]) assert.equal(run(at, [0.3, 0.2]), false, `gap ${at}`);
  });

for (const [language, run] of Object.entries(DASHES))
  test(`${language}: a dash of zero keeps every pixel, a gap of zero draws the line whole`, () => {
    for (const at of [0, 0.35, 2.7, 1000.4]) {
      assert.equal(run(at, [0, 0]), true);
      assert.equal(run(at, [0.3, 0]), true);
    }
  });

test('the texts are statement for statement the same formula', () => {
  const body = (text: string) => text.slice(text.indexOf('{')).replace(/let |float /g, '');
  assert.equal(body(LINE_DASH_WGSL), body(LINE_DASH_GLSL));
});

// Every path cuts its gaps with that text, at the distance the first coordinate carries.
test('every path that draws a line reads the dash, and a solid surface keeps every pixel', () => {
  // Both WebGPU rasters and the shadow cut through `maskKeep`, which a dashed row enters.
  assert.ok(PAGE_GEOMETRY_WGSL.includes(LINE_DASH_WGSL));
  assert.match(PAGE_INFO_STRUCT_WGSL, /packedBase:u32,dash:vec2f,clusterHash/);
  assert.equal(ROW_DASH_WORD, 28, 'the row words of PageInfo.dash');
  const keep = MASK_KEEP_WGSL.replace(/\s+\/\/[^\n]*/g, '');
  assert.ok(
    keep.includes(
      ' if((page.flags&128u)==0u){return true;}\n if(!lineDash(uv.x,page.dash)){return false;}\n if(page.baseColor.w<=0.0){return true;}',
    ),
  );
  assert.equal(VIS_SHADER.split('maskKeep(pages[in.instance],in.tc.xy,').length, 3);
  assert.ok(rasterSource(4, 16).includes('if(!maskKeep(page,tc.xy,tc.z,gx,gy,stipple)){return;}'));
  // The transparent pass.
  assert.ok(BLEND_SHADER.includes(LINE_DASH_WGSL));
  assert.match(BLEND_ITEM_WGSL, /emissive:vec4f,dash:vec2f,\}/);
  assert.ok(BLEND_SHADER.includes('out.alphaAo=vec4f(it.alphaTest,it.aoIntensity,it.dash);'));
  assert.ok(BLEND_SHADER.includes(' if(!lineDash(in.uv.x,in.alphaAo.zw)){discard;}'));
  // The opaque fallback.
  assert.ok(FALLBACK_SHADER.includes(LINE_DASH_WGSL));
  assert.ok(FALLBACK_SHADER.includes('viewport:vec2f,dash:vec2f,}'));
  assert.ok(FALLBACK_SHADER.includes('lineDistance=clusterUv(h,uni.pageOffset,'));
  assert.ok(FALLBACK_SHADER.includes(' if(!lineDash(in.lineDistance,uni.dash)){discard;}'));
  // WebGL2.
  assert.ok(CLUSTER_FRAGMENT.includes(LINE_DASH_GLSL));
  assert.ok(CLUSTER_FRAGMENT.includes('void main(){if(!lineDash(texcoord0.x,dash))discard;'));
});
