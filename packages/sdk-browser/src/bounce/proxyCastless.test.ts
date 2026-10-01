// #966 (from #558): the far sun's shadow ray passes the proxy triangles whose every owner casts no
// shadow (`castShadow = false`), as the clipmap levels leave such a mesh out of every light cut; a
// bounce ray still hits them. The proxy marks those groups, one bit each, in its own buffer.
import test from 'node:test';
import assert from 'node:assert/strict';
import { ownedProxy } from '../../../sdk-core/src/scene/core/proxy.fixture.ts';
import { fakeDevice, replayWrites } from '../../../../tests/kit/gpu/fakeDevice.ts';
import { sunFarShadowWgsl } from '../gpu/shadow/sunFarShadowWgsl.ts';
import { PROXY_CASTLESS_WORD, PROXY_HEADER_WORDS } from './nodeWgsl.ts';
import { SURFACE_IRRADIANCE_WGSL } from './irradianceWgsl.ts';
import { ensureProxyFits } from './limits.ts';
import { createGpuBounceProxy } from './proxy.ts';
import { BOUNCE_TRACE_WGSL } from './traceWgsl.ts';

test('a group is marked castless only when every owner casts none, and uploaded once', () => {
  const { device, buffers, writes } = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  });
  // One triangle, one group, owned by source nodes 0 and 1 (a surface merged from two meshes).
  const resident = createGpuBounceProxy(device, ownedProxy());
  const words = new Uint32Array(
    buffers.find((buffer) => buffer.label === 'Trillion3D resident proxy v2')!.getMappedRange(),
  );
  const bits = () => {
    replayWrites(words.buffer, writes.splice(0));
    return words[PROXY_HEADER_WORDS + words[PROXY_CASTLESS_WORD]];
  };
  assert.equal(bits(), 0, 'every group casts at creation');
  assert.equal(
    resident.castless((source) => source === 0),
    false,
    'source 1 still casts',
  );
  assert.equal(writes.length, 0);
  assert.equal(
    resident.castless((source) => source < 2),
    true,
  );
  assert.equal(bits(), 1, 'both owners cast none: the group is let through');
  assert.equal(
    resident.castless((source) => source !== 2),
    false,
    'the same marks write nothing',
  );
  assert.equal(writes.length, 0);
  assert.equal(
    resident.castless(() => false),
    true,
  );
  assert.equal(bits(), 0, 'a mesh casting again blocks the ray again');
});

test("each owner is asked with the mesh its source node places, from the proxy's column", () => {
  const { device } = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  });
  // Source nodes 0 and 1 both place mesh 0; source 2 places none (`sourceMeshes`).
  const resident = createGpuBounceProxy(device, ownedProxy());
  const asked: [number, number][] = [];
  resident.castless((source, mesh) => (asked.push([source, mesh]), mesh === 0));
  assert.deepEqual(asked, [
    [0, 0],
    [1, 0],
  ]);
  assert.equal(
    resident.castless((_, mesh) => mesh === -1),
    true,
    'marked, then cleared',
  );
});

test("only the far sun's ray lets a castless triangle through, before testing it", () => {
  const blocked = BOUNCE_TRACE_WGSL.slice(BOUNCE_TRACE_WGSL.indexOf('fn proxyBlocked('));
  assert.match(blocked, /casters:bool\)->bool\{/);
  assert.ok(
    blocked.indexOf('if(casters&&proxyCastless(index)){continue;}') <
      blocked.indexOf('triangleHit('),
  );
  for (const counting of [true, false])
    assert.match(sunFarShadowWgsl(counting), /proxyBlocked\(origin,L,[^;]*,true\)\)/);
  assert.match(SURFACE_IRRADIANCE_WGSL, /proxyBlocked\(offset,incidence\.xyz,span,false\)/);
});

test('the admission counts the castless marks: a device one word short refuses the proxy', () => {
  const sized = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 28, maxBufferSize: 1 << 28 },
  });
  createGpuBounceProxy(sized.device, ownedProxy());
  const size = sized.buffers.find((b) => b.label === 'Trillion3D resident proxy v2')!.size;
  const limits = (bytes: number) => ({
    maxStorageBufferBindingSize: bytes,
    maxBufferSize: 1 << 28,
  });
  assert.doesNotThrow(() =>
    createGpuBounceProxy(fakeDevice({ limits: limits(size) }).device, ownedProxy()),
  );
  assert.throws(() =>
    ensureProxyFits(fakeDevice({ limits: limits(size - 4) }).device, ownedProxy()),
  );
});
