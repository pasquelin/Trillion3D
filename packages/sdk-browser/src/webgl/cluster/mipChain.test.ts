// #732: on WebGL2 a mip filter over a texture without its chain reads an incomplete texture —
// black. The chain follows the filter alone, as on WebGPU: whatever the host's `generateMipmaps`
// says, and when a sampling moves to a mip filter with no new picture.
import test from 'node:test';
import assert from 'node:assert/strict';
import { WebglClusterTextures } from './textures.ts';
import { hostTextureWritten, importHostTexture } from '../../host/textureImport.ts';
import type { HostTexture } from '../../host/resources.ts';
import * as G from '../../host/graph/graph.fixture.ts';
import { createTestContext } from '../core/testContext.fixture.ts';

/** A WebGL2 double that samples a unit as GL does, replayed from the calls it recorded: its
 *  level 0, or black when its min filter reads levels the texture does not have. */
function sampledContext() {
  const { gl, calls } = createTestContext();
  const sample = (unit: number) => {
    const held = new Map<unknown, { picture?: Uint8Array; chain?: boolean; minFilter?: string }>(),
      units = new Map<unknown, unknown>();
    let active: unknown;
    const bound = () => held.get(units.get(active)) ?? {};
    for (const { name, args } of calls)
      if (name === 'activeTexture') active = args[0];
      else if (name === 'bindTexture') {
        units.set(active, args[1]);
        if (!held.has(args[1])) held.set(args[1], {});
      }
      // A new level 0 leaves the levels below it stale: the chain is built again or missing.
      else if (name === 'texImage2D' || name === 'texSubImage2D')
        Object.assign(bound(), { picture: args[8] as Uint8Array, chain: false });
      else if (name === 'generateMipmap') bound().chain = true;
      else if (name === 'texParameteri' && args[1] === 'TEXTURE_MIN_FILTER')
        bound().minFilter = args[2] as string;
    const { picture, chain, minFilter } = held.get(units.get(`TEXTURE0${unit}`))!;
    return minFilter?.includes('MIPMAP') && !chain ? [0, 0, 0, 0] : [...picture!.slice(0, 4)];
  };
  return { gl, sample };
}

/** A 2×2 texel map of one colour read through `minFilter`, as the host declares it: no
 *  `generateMipmaps`. */
function colourMap(minFilter: number) {
  const host = G.dataTexture(new Uint8Array(16).fill(200), 2, 2);
  host.minFilter = minFilter;
  return { host, map: importHostTexture(host as unknown as HostTexture) };
}

test('a mip filter samples its colour on WebGL2 though the host asks no chain', () => {
  const { gl, sample } = sampledContext();
  const { host, map } = colourMap(G.HOST_FILTER_LINEAR_MIP_LINEAR);
  new WebglClusterTextures(gl).bind(0, map);
  assert.equal(host.generateMipmaps, false);
  assert.deepEqual(sample(0), [200, 200, 200, 200]);
});

test('a sampling moved to a mip filter with no new picture samples its colour', () => {
  const { gl, sample } = sampledContext();
  const { host, map } = colourMap(G.HOST_FILTER_NEAREST);
  const binder = new WebglClusterTextures(gl);
  binder.bind(0, map);
  assert.deepEqual(sample(0), [200, 200, 200, 200], 'nearest: level 0, no chain asked');
  const version = map.version;
  host.minFilter = G.HOST_FILTER_NEAREST_MIP_NEAREST;
  hostTextureWritten();
  binder.bind(0, map);
  assert.equal(map.version, version, 'the sampler moved alone');
  assert.deepEqual(sample(0), [200, 200, 200, 200]);
});
