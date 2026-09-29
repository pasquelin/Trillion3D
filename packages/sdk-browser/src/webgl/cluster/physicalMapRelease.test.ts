import test from 'node:test';
import assert from 'node:assert/strict';
import { WebglClusterOwner } from './owner.ts';
import { WebglClusterTextures } from './textures.ts';
import { Matrix3UniformCache } from './uniforms.ts';
import { visMaterial } from '../../visibility/shader/material.ts';
import { createTestContext } from '../core/testContext.fixture.ts';
import { importHostTexture } from '../../host/textureImport.ts';
import * as G from '../../host/graph/graph.fixture.ts';

test('declared material removal and source retirement release copied physical arrays', () => {
  const context = createTestContext({ answers: { getParameter: () => 4096 } });
  const owner = new WebglClusterOwner(context.gl, () => {});
  // The display/linear renderers share this texture owner; exercise their public release cycle.
  const textures = (owner as unknown as { display: { textures: WebglClusterTextures } }).display
    .textures;
  const source = importHostTexture(G.dataTexture(new Uint8Array(16), 2, 2));
  const material = G.standardSurface();
  const values = { ...visMaterial([]), anisotropyMap: source };
  const matrices = new Matrix3UniformCache(context.gl, () => null);
  const bind = () => textures.physical(material, values, () => null, matrices);
  bind();
  assert.ok(textures.physicalMaps!.bytes > 0);
  owner.releaseMaterial(material);
  assert.equal(textures.physicalMaps!.bytes, 0);
  bind();
  owner.census([], {});
  assert.equal(textures.physicalMaps!.bytes, 0);
  bind();
  textures.release(source);
  assert.equal(textures.physicalMaps!.bytes, 0);
  owner.dispose();
});
