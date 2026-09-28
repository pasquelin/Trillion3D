// A view that keeps more clusters than the readout list holds (#973): the list grows within the
// device and the cut stays on the GPU with every drawn cluster listed; only a list the device
// cannot hold stays truncated, for the host to fall back and say so. The readbacks are written
// here, as the kernels would; that the kernels write them so is the GPU's to prove.
import test from 'node:test';
import assert from 'node:assert/strict';
import { deviceListCap, grownListCap, initialListCap } from './listCap.ts';
import { SELECTION_HEADER_WORDS as HEAD, SELECTION_LIST_CAP, stagedOutputBytes } from './layout.ts';
import { createDagResources } from './resources.ts';
import { createDagRuntime } from './runtime.ts';
import { packDagSelection } from './selection.ts';
import { packRequest } from './request.ts';
import { DAG_BINDING } from './shader/bindings.ts';
import { createSelectionUniforms } from '../core/selection.ts';
import { dagFixture } from '../../page/selection/dag.fixture.ts';
import { packed } from './selectionHelpers.fixture.ts';
import { fakeDevice, written } from '../../../../../tests/kit/gpu/fakeDevice.ts';

test('the list a device holds is the largest whose readout one binding holds', () => {
  const limits = { maxStorageBufferBindingSize: 128 << 20 };
  const cap = deviceListCap(limits);
  assert.ok(stagedOutputBytes(cap) <= 128 << 20 && stagedOutputBytes(cap + 1) > 128 << 20);
  assert.equal(initialListCap(limits, 2_000_000), SELECTION_LIST_CAP, 'a real device: as before');
  assert.equal(initialListCap(limits, 1000), 1000, 'never more than the catalogue');
  assert.equal(initialListCap({ maxStorageBufferBindingSize: stagedOutputBytes(9) }, 1000), 9);
});

test('a truncated list doubles past what the cut asked, within the catalogue and the device', () => {
  const limits = { maxStorageBufferBindingSize: stagedOutputBytes(1000) };
  assert.equal(grownListCap(limits, 5000, 100, 150), 300);
  assert.equal(grownListCap(limits, 5000, 100, 30), 200);
  assert.equal(grownListCap(limits, 250, 100, 180), 250, 'the catalogue bounds it');
  assert.equal(grownListCap(limits, 5000, 100, 800), 1000, 'the device bounds it');
  assert.equal(grownListCap(limits, 5000, 100, 1200), undefined, 'past the device: stays');
  assert.equal(grownListCap(limits, 5000, 1000, 1200), undefined, 'already at the device');
});

/** Forty-eight placements of the fixture's primitive, cut on a list of `cap` ranks. */
async function cut(cap: number, limits = {}) {
  const [root] = packed(dagFixture()).roots;
  const dag = packDagSelection(Array.from({ length: 48 }, () => root));
  const fake = fakeDevice({ limits });
  const resources = await createDagResources(fake.device, dag, true, null, cap);
  assert.ok(resources);
  const selection = createDagRuntime(resources);
  const uniforms = createSelectionUniforms();
  // The image's encoder: its compute passes do nothing, its copy names the readback slot.
  let slot: GPUBuffer | undefined;
  const pass = new Proxy({}, { get: () => () => {} });
  const encoder = {
    beginComputePass: () => pass,
    copyBufferToBuffer: (_: GPUBuffer, _at: number, to: GPUBuffer) => void (slot = to),
  } as unknown as GPUCommandEncoder;
  /** One dispatch whose readback holds `drawn` pages under the list it was cut on. */
  const frame = async (drawn: number[]) => {
    selection.dispatch(uniforms, encoder)?.(true);
    const { listCap } = resources,
      kept = drawn.slice(0, listCap);
    const ints = new Uint32Array(slot!.getMappedRange());
    ints.set([drawn.length, 0, 0, drawn.length > listCap ? 1 : 0]);
    ints.set(
      kept.map((page) => packRequest(page, 1)),
      HEAD,
    );
    ints[HEAD + listCap] = drawn.length;
    ints.set(kept, 2 * HEAD + listCap);
    await selection.flush();
    return selection.peek();
  };
  return { fake, resources, frame };
}

test('a cut past its list grows it and stays on the GPU, every drawn cluster listed', async () => {
  const { fake, resources, frame } = await cut(4);
  const old = [resources.output, ...resources.readback];
  const drawn = Array.from({ length: 10 }, (_, page) => page);
  assert.equal(await frame(drawn), null, 'the truncated readout is not handed over');
  const grown = await frame(drawn);
  assert.equal(resources.listCap, 20);
  assert.deepEqual(grown?.result.drawablePageIds, drawn, 'no visible cluster dropped');
  assert.deepEqual(grown?.result.pageIds, drawn);
  assert.equal(grown?.result.truncated, false);
  assert.equal(resources.output.size, stagedOutputBytes(20));
  assert.ok(
    old.every((buffer) => fake.destroyed.includes(buffer)),
    'the old readout released',
  );
  assert.ok(!resources.buffers.some((buffer) => old.includes(buffer)));
  const outOf = (group: GPUBindGroup) =>
    (group as unknown as GPUBindGroupDescriptor).entries.find((e) => e.binding === DAG_BINDING.out);
  assert.equal(
    (outOf(resources.ranges[0].bindGroup)?.resource as GPUBufferBinding).buffer,
    resources.output,
  );
  const block = fake.writes.filter((w) => w.buffer === resources.uniforms).at(-1)!;
  assert.equal(new Uint32Array(written(block).buffer)[52], 20, 'the kernels read the new cap');
});

test('a list the device cannot hold stays truncated, for the host to fall back', async () => {
  const { resources, frame } = await cut(4, { maxStorageBufferBindingSize: stagedOutputBytes(4) });
  const drawn = Array.from({ length: 10 }, (_, page) => page);
  assert.equal((await frame(drawn))?.result.truncated, true);
  assert.equal((await frame(drawn))?.result.truncated, true);
  assert.equal(resources.listCap, 4, 'no growth past the device');
});
