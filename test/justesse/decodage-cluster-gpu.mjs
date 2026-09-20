// The WGSL decode of a quantized cluster page, run in Chromium WebGPU, against the JavaScript
// decoder of the same bytes: positions, texture coordinates and colours bit for bit — the
// format's arithmetic is one multiply and one add, both correctly rounded in WGSL —, normals to
// the tolerance WGSL grants `normalize`, indices exact, and the reconstructed tangent unit,
// orthogonal to the normal, with the handedness of its texture frame.
//   node --experimental-strip-types test/justesse/decodage-cluster-gpu.mjs
import assert from 'node:assert/strict';
import { encodeGeometryPage } from '../../packages/page-codec/geometryPage.mjs';
import { decodeGeometryPage } from '../../packages/sdk-browser/geometryPage.ts';
import { decodageClusterGpu, VERTEX_WORDS } from './decodageClusterGpu.mjs';

/** A ring of `triangles` triangles: shared vertices, every attribute, positions off the grid. */
function page(triangles, exponent) {
  const count = triangles + 2,
    position = new Float32Array(count * 3),
    normal = new Float32Array(count * 3),
    uv = new Float32Array(count * 2),
    uv2 = new Float32Array(count * 2),
    color = new Float32Array(count * 4);
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2;
    position.set([Math.cos(angle) * 2.3 + 100.7, Math.sin(angle) * 2.3 - 40.1, i * 0.0173], i * 3);
    normal.set([Math.cos(angle) * 0.6, Math.sin(angle) * 0.6, i % 2 ? 0.8 : -0.8], i * 3);
    uv.set([i / count, 0.5 + Math.sin(angle) * 0.25], i * 2);
    uv2.set([3 + i * 0.01, 7 - i * 0.02], i * 2);
    color.set([i / count, 1 - i / count, 0.5, 1], i * 4);
  }
  const indices = [];
  for (let t = 0; t < triangles; t++) indices.push(t, t + 1, t + 2);
  const { data } = encodeGeometryPage(
    indices,
    {
      POSITION: { itemSize: 3, array: position },
      NORMAL: { itemSize: 3, array: normal },
      TEXCOORD_0: { itemSize: 2, array: uv },
      TEXCOORD_1: { itemSize: 2, array: uv2 },
      COLOR_0: { itemSize: 4, array: color },
    },
    exponent,
  );
  const decoded = decodeGeometryPage(data);
  return { octets: data, vertexCount: decoded.vertexCount, indexCount: indices.length, decoded };
}

const pages = [page(126, -12), page(5, -3), page(40, -20)];
const gpu = await decodageClusterGpu(pages);
assert.equal(gpu.indisponible ?? null, null, gpu.indisponible);
assert.deepEqual([...(gpu.compilation ?? []), ...(gpu.erreurs ?? [])], []);

const floats = (words) => new Float32Array(Uint32Array.from(words).buffer);
let pireNormale = 0,
  pireTangente = 0,
  sansAire = 0;
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
  for (let t = 0; t < indexCount / 3; t++) {
    const base = vertexCount * VERTEX_WORDS + t * 7,
      corners = [words[base], words[base + 1], words[base + 2]];
    assert.deepEqual(
      corners,
      Array.from(decoded.indices.subarray(t * 3, t * 3 + 3)),
      `page ${k} triangle ${t}`,
    );
    const tangent = [values[base + 3], values[base + 4], values[base + 5]],
      n = corners[0];
    // Three corners on one texture line have no frame: the routine says so with a zero.
    if (Math.hypot(...tangent) === 0) {
      assert.equal(values[base + 6], 0, `page ${k} handedness ${t}`);
      sansAire++;
      continue;
    }
    const dot = tangent.reduce((sum, v, c) => sum + v * normal[n * 3 + c], 0);
    pireTangente = Math.max(pireTangente, Math.abs(Math.hypot(...tangent) - 1), Math.abs(dot));
    assert.ok(Math.abs(values[base + 6]) === 1, `page ${k} handedness ${t}`);
  }
}
console.log(
  JSON.stringify({
    adaptateur: gpu.adaptateur,
    pages: pages.length,
    pireNormale,
    pireTangente,
    sansAire,
  }),
);
// `normalize` is granted a few ULP by WGSL; a bit-exact normal is not what the format promises.
assert.ok(pireNormale < 1e-6, `normal off by ${pireNormale}`);
assert.ok(pireTangente < 1e-5, `tangent off by ${pireTangente}`);
