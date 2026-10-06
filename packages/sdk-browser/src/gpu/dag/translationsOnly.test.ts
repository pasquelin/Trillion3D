// A send the caller declares translations-only skips the stretch scan. Oracle: the same sends
// without the declaration — every GPU buffer, the stretches and the revisions must end the same,
// on ±0 linear parts and non-finite translations. A non-finite linear part never gets that far:
// the scan of the full send refuses it (`maxStretch`), and the caller then sends whole again.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createGpuDagSelection } from './selection.ts'
import { dagFixture } from '../../page/selection/dag.fixture.ts'
import { mockDagDevice } from './selection.fixture.ts'
import { installGpuGlobals } from '../../../../../tests/kit/gpu/globals.ts'
import { packed } from './selectionHelpers.fixture.ts'
import { random } from '../../page/cut/cutRuleChecks.fixture.ts'

const LINEAR = [0, 1, 2, 4, 5, 6, 8, 9, 10]

/** A selection on its own packed copy of the fixture, and every buffer its device created. */
async function mounted(fixture: ReturnType<typeof dagFixture>) {
  const { dag } = packed(fixture)
  const { device } = mockDagDevice(dag)
  const buffers: { data: Uint8Array }[] = [],
    create = device.createBuffer.bind(device)
  device.createBuffer = ((desc: GPUBufferDescriptor) => {
    const buffer = create(desc)
    buffers.push(buffer as unknown as { data: Uint8Array })
    return buffer
  }) as typeof device.createBuffer
  const selection = await createGpuDagSelection(device, dag)
  assert.ok(selection)
  return { dag, selection, buffers }
}

const TRANSLATION_EDGES = [NaN, Infinity, -Infinity, -0, 0, 1e39]

async function assertSameSends(linearEdge: number) {
  installGpuGlobals()
  const fixture = dagFixture()
  const plain = await mounted(fixture),
    declared = await mounted(fixture)
  const next = random(918 + Math.sign(1 / linearEdge)),
    worlds = plain.dag.worlds.slice()
  for (let step = 0; step < 12; step++) {
    const posed = step % 4 === 0
    for (let w = 0; w < plain.dag.worldCount; w++) {
      const at = w * 16
      if (posed) for (const k of LINEAR) worlds[at + k] = (next() - 0.5) * 4
      if (posed && w === 0) worlds[at + 5] = linearEdge
      for (let k = 12; k < 15; k++) worlds[at + k] = (next() - 0.5) * 2e5
      if (w === 0 && step > 4) worlds[at + 12 + (step % 3)] = TRANSLATION_EDGES[step % 6]
    }
    const sent = worlds.slice()
    const a = plain.selection.updateWorlds(sent, posed),
      b = declared.selection.updateWorlds(sent, posed, !posed)
    assert.equal(b, a, `step ${step}: same verdict`)
    assert.equal(declared.selection.worldRevision, plain.selection.worldRevision)
    assert.deepEqual(
      new Uint32Array(declared.dag.worldStretch.buffer),
      new Uint32Array(plain.dag.worldStretch.buffer),
    )
    assert.equal(declared.buffers.length, plain.buffers.length)
    plain.buffers.forEach((buffer, i) =>
      assert.deepEqual(declared.buffers[i].data, buffer.data, `step ${step}, buffer ${i}`),
    )
  }
  plain.selection.dispose()
  declared.selection.dispose()
  fixture.geometry.dispose()
}

test('translations-only sends leave every buffer as the scanned sends do', () =>
  assertSameSends(1.5))

test('the same with a -0 in a linear part, which the scan takes for 0', () => assertSameSends(-0))
