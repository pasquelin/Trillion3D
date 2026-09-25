// #443: a map of raw texels — `texture.data`, a file the loader decoded — is drawn on WebGL2 as on
// WebGPU: uploaded as the RGBA8 bytes it holds, with the mip chain its filter reads, and a
// storage the WebGL2 upload cannot read as it is stored is refused by name, never drawn blank.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../host/graph/graph.fixture.ts';
import { createSceneDraw } from './sceneDraw.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import { createHostDrawCamera, type HostCamera } from '../../camera/world.ts';
import { clusterMaterialReason } from './compatibility.ts';
import { hostSurface } from '../../world/core/worldSurface.ts';
import { texture } from '../../world/texture/index.ts';
import { material } from '../../../../sdk-core/src/world/material/index.ts';

/** A triangle with the position, normal and UV a lit textured surface reads. */
function texturedTriangle() {
  const geometry = new G.Geometry().setIndex([0, 1, 2]);
  for (const name of ['position', 'normal', 'uv'])
    geometry.setAttribute(name, G.floatAttribute(new Float32Array(9), name === 'uv' ? 2 : 3));
  return geometry;
}

/** A world surface wearing `map` as its normal map, as `bricks-with-a-normal-map` wears one. */
const wearing = (map: ReturnType<typeof texture.data>) =>
  hostSurface(material.meshStandard({ normalMap: map }), false, new Map());

test('a world texel map is drawn on WebGL2, uploaded as stored, with its box chain', () => {
  const pixels = new Uint8Array(4 * 4 * 4).fill(128);
  const scene = new G.GraphScene();
  scene.add(G.mesh(texturedTriangle(), wearing(texture.data(pixels, 4, 4))));
  const gl = createTestContext();
  const draw = createSceneDraw(gl.gl, scene);
  draw.render({} as HostCamera);
  draw.drawHostGeometry(createHostDrawCamera(), {
    toneMapped: false,
    framebuffer: null,
    width: 8,
    height: 4,
  });
  draw.dispose();
  const uploads = gl.of('texImage2D');
  assert.ok(
    uploads.some((args) => (args[8] as ArrayBufferView | null)?.buffer === pixels.buffer),
    'uploaded as the bytes it holds',
  );
  // A normal map is bound as data: its chain is the plain box chain (#42), and complete.
  assert.equal(
    gl.of('generateMipmap').length,
    1,
    'no chain: a mip filter reads an incomplete texture',
  );
});

test('texels the WebGL2 upload cannot read as stored are refused by name', () => {
  const { attributes } = texturedTriangle();
  const accepted = wearing(texture.data(new Uint8Array(16), 2, 2));
  assert.equal(clusterMaterialReason(accepted, attributes), undefined);
  for (const [map, reason] of [
    [texture.data(new Uint8Array(12), 2, 2, 'rgb'), /texel format 1022 is unsupported/],
    [texture.data(new Uint8Array(4), 2, 2, 'r'), /texel format 1028 is unsupported/],
    [texture.data(new Float32Array(16), 2, 2), /8-bit texels only/],
    [texture.data(new Uint8Array(8), 2, 2), /holds 8 bytes, not 2×2 RGBA/],
  ] as const)
    assert.match(clusterMaterialReason(wearing(map), attributes) ?? '', reason);
});
