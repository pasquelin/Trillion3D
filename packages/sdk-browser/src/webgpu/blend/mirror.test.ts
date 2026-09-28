import test from 'node:test';
import assert from 'node:assert/strict';
import { voidStaleBlendGroups } from './identity.ts';
import { createWebgpuBlendState } from './state.ts';
import { BLEND_SHADER } from './shader.ts';
import {
  blendBindEntries,
  type BlendBindResources,
  type BlendLighting,
} from '../core/bindEntries.ts';
import { BLEND_BINDINGS } from '../core/bindLayout.ts';
import type { WebgpuPagesRuntime } from '../pages/runtime.ts';
import { functionText } from '../../bounce/wgslBody.fixture.ts';
import { BOUNCE_LIGHTING_SHADER } from '../../lighting/deferred/shaders.ts';

test('transparent mirrors use the opaque reflection model and bind its surface radiance', () => {
  for (const name of ['mirrorLighting', 'reflectedRadiance', 'rayRadiance'])
    assert.equal(functionText(BLEND_SHADER, name), functionText(BOUNCE_LIGHTING_SHADER, name));
  assert.match(BLEND_SHADER, /\+mirrorLighting\(rgb,m,clamped,s.N,V,in.view\)/);
  const surfaceCache = {} as GPUBuffer;
  const atlas = { views: [], pages: { buffer: {} } };
  const entries = blendBindEntries({
    surfaceCache,
    textures: { color: atlas, data: atlas },
  } as unknown as BlendBindResources);
  assert.deepEqual(
    entries.find((entry) => entry.binding === BLEND_BINDINGS.surfaceCache)?.resource,
    { buffer: surfaceCache },
  );
});

test('a replaced surface cache invalidates both blend groups, unchanged radiance storage does not', () => {
  const blendState = createWebgpuBlendState();
  const item = { group: undefined as GPUBindGroup | undefined };
  blendState.blendGpu.push(item as (typeof blendState.blendGpu)[number]);
  const rt = { gpu: {}, vis: {}, blendState } as unknown as WebgpuPagesRuntime;
  const lighting = { surfaceCache: {} } as BlendLighting;
  voidStaleBlendGroups(rt, lighting);
  const group = {} as GPUBindGroup;
  blendState.pagedGroup = group;
  item.group = group;
  voidStaleBlendGroups(rt, lighting);
  assert.equal(blendState.pagedGroup, group);
  assert.equal(item.group, group);
  lighting.surfaceCache = {} as GPUBuffer;
  voidStaleBlendGroups(rt, lighting);
  assert.equal(blendState.pagedGroup, undefined);
  assert.equal(item.group, undefined);
});
