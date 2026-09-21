// The WGSL decode of a quantized cluster page, run in Chromium WebGPU, against the JavaScript
// decoder of the same bytes: positions, texture coordinates and colours bit for bit — the
// format's arithmetic is one multiply and one add, both correctly rounded in WGSL —, normals to
// the tolerance WGSL grants `normalize`, indices exact, and the cotangent frame every lighting
// pass bends its normal map with, against the same formula in JavaScript.
//   node --experimental-strip-types test/justesse/decodage-cluster-gpu.mjs
import assert from 'node:assert/strict';
import { decodeGeometryPage } from '../../packages/sdk-browser/geometryPage.ts';
import { anneau } from '../../packages/sdk-browser/bench/appui/pagesWasm.mjs';
import { decodageClusterGpu, TRIANGLE_WORDS, VERTEX_WORDS } from './decodageClusterGpu.mjs';

function page(triangles, exponent) {
  const { encoded, indices } = anneau(triangles, exponent);
  const decoded = decodeGeometryPage(encoded.data);
  return { octets: encoded.data, vertexCount: decoded.vertexCount, indexCount: indices.length, decoded };
}

const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub = (a, b) => a.map((v, i) => v - b[i]);
/** The frame of a triangle, as the shader computes it: `p * du1 + q * du2`, the longer unit. */
function cotangentFrame(N, e1, e2, duv1, duv2) {
  const p = cross(e2, N),
    q = cross(N, e1);
  const T = p.map((v, i) => v * duv1[0] + q[i] * duv2[0]),
    B = p.map((v, i) => v * duv1[1] + q[i] * duv2[1]);
  const scale = 1 / Math.sqrt(Math.max(Math.hypot(...T) ** 2, Math.hypot(...B) ** 2, 1e-20));
  return [...T.map((v) => v * scale), ...B.map((v) => v * scale)];
}

const pages = [page(126, -12), page(5, -3), page(40, -20)];
const gpu = await decodageClusterGpu(pages);
assert.equal(gpu.indisponible ?? null, null, gpu.indisponible);
assert.deepEqual([...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])], []);

const floats = (words) => new Float32Array(Uint32Array.from(words).buffer);
let pireNormale = 0,
  pireRepere = 0;
for (const [k, { decoded, vertexCount, indexCount }] of pages.entries()) {
  const words = gpu.resultats[k],
    values = floats(words),
    { position, normal, uv, uv2, color } = decoded.attributes;
  for (let i = 0; i < vertexCount; i++) {
    const base = i * VERTEX_WORDS;
    for (let c = 0; c < 3; c++) {
      assert.ok(Object.is(values[base + c], position[i * 3 + c]), `page ${k} position ${i}.${c}`);
      pireNormale = Math.max(pireNormale, Math.abs(values[base + 3 + c] - normal[i * 3 + c]));
    }
    for (let c = 0; c < 2; c++) {
      assert.ok(Object.is(values[base + 6 + c], uv[i * 2 + c]), `page ${k} uv ${i}.${c}`);
      assert.ok(Object.is(values[base + 8 + c], uv2[i * 2 + c]), `page ${k} uv2 ${i}.${c}`);
    }
    for (let c = 0; c < 4; c++)
      assert.ok(Object.is(values[base + 10 + c], color[i * 4 + c]), `page ${k} colour ${i}.${c}`);
  }
  const at = (array, i, n) => Array.from(array.subarray(i * n, i * n + n));
  for (let t = 0; t < indexCount / 3; t++) {
    const base = vertexCount * VERTEX_WORDS + t * TRIANGLE_WORDS,
      corners = [words[base], words[base + 1], words[base + 2]];
    assert.deepEqual(
      corners,
      Array.from(decoded.indices.subarray(t * 3, t * 3 + 3)),
      `page ${k} triangle ${t}`,
    );
    const [a, b, c] = corners,
      p0 = at(position, a, 3),
      t0 = at(uv, a, 2);
    const expected = cotangentFrame(
      at(normal, a, 3),
      sub(at(position, b, 3), p0),
      sub(at(position, c, 3), p0),
      sub(at(uv, b, 2), t0),
      sub(at(uv, c, 2), t0),
    );
    for (let c = 0; c < 6; c++)
      pireRepere = Math.max(pireRepere, Math.abs(values[base + 3 + c] - expected[c]));
  }
}
console.log(JSON.stringify({ adaptateur: gpu.adaptateur, pages: pages.length, pireNormale, pireRepere }));
// `normalize` and the frame's `inverseSqrt` are granted a few ULP by WGSL; bit-exact normals are
// not what the format promises.
assert.ok(pireNormale < 1e-6, `normal off by ${pireNormale}`);
assert.ok(pireRepere < 1e-5, `frame off by ${pireRepere}`);
