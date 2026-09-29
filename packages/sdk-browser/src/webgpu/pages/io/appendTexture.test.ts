// #847: a live session's colour atlas takes a texture after open by the open's own path: a slot
// in its catalogue, its page table regrown by copy, the feedback counting its ranks, its
// tail pinned, every group naming the atlas rebuilt once, and its counters published.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as G from '../../../host/graph/graph.fixture.ts';
import { importHostTexture } from '../../../host/textureImport.ts';
import type { HostTexture } from '../../../host/resources.ts';
import type { WebgpuPagesBackend } from '../runtime.ts';
import type { BackendDiagnostic } from '../../../backend/types.ts';
import { installGpuGlobals } from '../../../../../../tests/kit/gpu/globals.ts';
import { mockGpu } from '../../../../../../tests/kit/gpu/mockGpu.ts';
import { camera, quadBackend } from '../testScenes.fixture.ts';

type Group = { entries: Array<{ resource?: { buffer?: unknown } }> };

test('a texture appended after open joins the atlas, regrows its table and rebinds once', async () => {
  installGpuGlobals();
  const { device, buffers } = mockGpu();
  const groups: Group[] = [];
  const createBindGroup = device.createBindGroup.bind(device);
  device.createBindGroup = (descriptor) => (
    groups.push(descriptor as unknown as Group),
    createBindGroup(descriptor)
  );
  const diagnostics: BackendDiagnostic[] = [];
  const { fixture, backend } = quadBackend(device, {
    onDiagnostic: (diagnostic) => diagnostics.push(diagnostic),
  });
  const labelled = (label: string) => buffers.filter((buffer) => buffer.label?.includes(label));
  const host = G.dataTexture(new Uint8Array(512 * 512 * 4), 512, 512);
  const map = importHostTexture(host as unknown as HostTexture);
  try {
    await backend.prepare();
    backend.render(camera());
    const before = backend.metrics();
    assert.equal(typeof before.textureTilesResident, 'number');
    const slot = await (backend as WebgpuPagesBackend).appendTexture(map, 'color');
    assert.equal(
      await (backend as WebgpuPagesBackend).appendTexture(map, 'color'),
      slot,
      'held: the same slot',
    );
    const appended = diagnostics.filter(({ phase }) => phase === 'material-texture-appended');
    assert.equal(appended.length, 1);
    const { catalogue, pageTables, pool } = appended[0].context as {
      catalogue: { count: number; host: number };
      pageTables: { color: { slots: number; bytes: number } };
      pool: { bytes: number };
    };
    assert.deepEqual([catalogue.count, catalogue.host], [slot, 1]);
    assert.equal(pageTables.color.slots, slot + 1);
    const pages = labelled('texture pages color');
    assert.equal(pages.length, 2, 'the table regrown by copy into a buffer of its new size');
    assert.equal(pages[1].size, pageTables.color.bytes);
    assert.equal(labelled('texture pages data').length, 2, 'the data ranks moved behind it');
    assert.equal(labelled('texture feedback').length, 6, 'the feedback counts the 21 new ranks');
    groups.length = 0;
    backend.render(camera());
    const naming = groups.filter((group) =>
      group.entries.some((entry) => entry.resource?.buffer === pages[1]),
    );
    assert.ok(naming.length > 0, 'the groups naming the atlas are rebuilt on the new table');
    groups.length = 0;
    backend.render(camera());
    assert.equal(groups.length, 0, 'once');
    const after = backend.metrics();
    assert.equal(after.textureTilesResident, before.textureTilesResident! + 1, 'its tail pinned');
    assert.equal(after.texturePoolBytes, pool.bytes, 'a free place: the pool as it was');
    assert.equal(after.texturePoolBytes, before.texturePoolBytes);
    const failed = diagnostics.filter(({ phase }) => /fail|refused|refusal/.test(phase));
    assert.deepEqual(failed, []);
  } finally {
    await backend.dispose();
    fixture.geometry.dispose();
    fixture.material.dispose();
  }
});
