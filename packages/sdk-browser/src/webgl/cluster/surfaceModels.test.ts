// #527: every family the engine maps onto its one model draws on the WebGL2 path, each shaded by
// the rule the WebGPU path reads, instead of being refused at prepare.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import * as G from '../../host/graph/graph.fixture.ts';
import { clusterMaterialReason } from './compatibility.ts';
import { CLUSTER_FRAGMENT } from './shaders.ts';
import {
  SURFACE_MODEL,
  SURFACE_MODEL_GLSL,
  SURFACE_MODEL_LIGHT_WGSL,
  TOON_BANDS,
} from '../../scene/surfaceModel.ts';

const { attributes } = G.boxGeometry();
const { position, normal } = attributes;

test('Every family the one model reads draws on WebGL2, reading its normals; another is refused', () => {
  for (const family of ['depth', 'lambert', 'phong', 'toon', 'normal', 'matcap'] as const) {
    const surface = new G.GraphSurface(family);
    assert.equal(clusterMaterialReason(surface, { position, normal }), undefined, family);
    const refusal = family === 'depth' ? undefined : `${family} material has no normal attribute`;
    assert.equal(clusterMaterialReason(surface, { position }), refusal, family);
  }
  const shader = { family: 'shader' } as unknown as G.GraphSurface;
  assert.equal(clusterMaterialReason(shader, { position }), 'material shader is unsupported');
  // A name the prototype of an object carries is no family either.
  const named = { family: 'constructor' } as unknown as G.GraphSurface;
  assert.equal(clusterMaterialReason(named, { position }), 'material constructor is unsupported');
});

test("A matcap's image is checked as a map, and asks for no UV: the normal reads it", () => {
  const image = G.dataTexture(new Uint8Array([255, 0, 0, 255]), 1, 1, G.HOST_FORMAT_RGBA);
  const matcap = new G.GraphSurface('matcap', { matcap: image });
  assert.equal(clusterMaterialReason(matcap, { position, normal }), undefined);
  // A base map beside it is never read, the import binding the matcap in its place: no UV asked.
  const both = new G.GraphSurface('matcap', { matcap: image, map: image });
  assert.equal(clusterMaterialReason(both, { position, normal }), undefined);
  // Nor does the relief or occlusion an unlit model never reads: the import drops them.
  for (const family of ['normal', 'matcap'] as const) {
    const unread = new G.GraphSurface(family, { normalMap: image, aoMap: image });
    assert.equal(clusterMaterialReason(unread, { position, normal }), undefined, family);
  }
  image.image = undefined as never;
  assert.equal(clusterMaterialReason(matcap, { position, normal }), 'texture image is unavailable');
});

/** The arguments of every `modelLight` call in `code`, split at their top-level commas. */
function modelLightCalls(code: string) {
  const calls: string[][] = [];
  for (let at = code.indexOf('modelLight('); at >= 0; at = code.indexOf('modelLight(', at + 1)) {
    if (/(?:fn |vec3 )$/.test(code.slice(0, at))) continue; // the definition itself
    const args = [''];
    for (let i = at + 'modelLight('.length, depth = 0; depth >= 0; i++) {
      const c = code[i];
      depth += c === '(' ? 1 : c === ')' ? -1 : 0;
      if (depth < 0) break;
      if (c === ',' && depth === 0) args.push('');
      else args[args.length - 1] += c;
    }
    calls.push(args);
  }
  return calls;
}

test('The lamp and rectangle branches of both languages call the one model alike', async () => {
  const source = (file: string) =>
    readFile(new URL(`../../lighting/direct/${file}`, import.meta.url), 'utf8');
  const wgsl = modelLightCalls(
    (await source('lightingWgsl.ts')) + (await source('rectLightWgsl.ts')),
  );
  const glsl = modelLightCalls(CLUSTER_FRAGMENT);
  // A lamp, a rectangle's diffuse and its toon bands: three sites a language cannot lose.
  assert.equal(wgsl.length, 3);
  assert.equal(glsl.length, 3);
  for (const call of [...wgsl, ...glsl]) {
    assert.equal(call.length, 6, call.join());
    assert.deepEqual([call[1], call[2], call[5]], ['metal', 'N', 'ao'], call.join());
  }
  // The rectangle's diffuse takes its irradiance whole, at a unit N·L, in both.
  const whole = (calls: string[][]) => calls.filter((call) => call[3] === 'N' && call[4] === 'E');
  assert.equal(whole(wgsl).length, 1);
  assert.equal(whole(glsl).length, 1);
  // Both read one toon band, and a lamp takes the model on a diffuse or toon surface alone.
  assert.ok(SURFACE_MODEL_LIGHT_WGSL.includes(`diffuse*${TOON_BANDS}`));
  assert.ok(SURFACE_MODEL_GLSL.includes(`diffuse*${TOON_BANDS}`));
  const { diffuse, toon, matcap, normal: shown } = SURFACE_MODEL;
  assert.ok(SURFACE_MODEL_GLSL.includes(`surfaceModel==${diffuse}||surfaceModel==${toon}`));
  assert.match(
    CLUSTER_FRAGMENT,
    /if\(bandedModel\(\)\)\{direct\+=modelLight\([^;]+;continue;\}vec3 E=/,
  );
  // A matcap reads its base map at the view normal, at its finest level as the surface pass does
  // (zero gradients); a normal surface shows it, after the fog.
  assert.ok(
    CLUSTER_FRAGMENT.includes(
      `surfaceModel==${matcap}?textureLod(baseMap,mapUv(baseUv,matcapUv(surfaceNormal)),0.0):`,
    ),
  );
  const fogAt = CLUSTER_FRAGMENT.indexOf('rgb=fogged(rgb);');
  assert.ok(fogAt < CLUSTER_FRAGMENT.indexOf(`if(surfaceModel==${shown})rgb=N*0.5+0.5;`));
});
