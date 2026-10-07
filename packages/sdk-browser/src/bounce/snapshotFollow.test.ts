// The probes' snapshot takes no copy of the whole atlas each image (2 × the atlas's bytes): it
// takes, by a dispatch of the probe pass after the update, the texels of the probes the
// queue names (`followSnapshot`). Run here on the shipped text over atlases of random words: after
// an update that writes the texels the update kernel stores, the snapshot equals the probes word
// for word — which is what the copy gave the next image to read.
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslConstants } from '../texture/shaderRule.fixture.ts'
import { BOUNCE_PROBE_SHADER, BOUNCE_SNAPSHOT_SHADER, BOUNCE_WORKGROUP } from './probeWgsl.ts'
import { PROBE_TEXELS } from './atlas.ts'
import { random } from '../page/cut/cutRuleChecks.fixture.ts'
import { fakeDevice } from '../../../../tests/kit/gpu/fakeDevice.ts'
import { floorProxy } from '../../../sdk-core/src/scene/core/proxy.fixture.ts'
import { createGpuBounceProbes } from './probes.ts'
import { BOUNCE_PASS } from '../stage/passLabels.ts'
import { ceilDiv } from '../../../math/src/scalar/integers.ts'

type Atlas = { width: number; height: number; texels: number[][] }

const atlas = (width: number, height: number, layers: number, fill: () => number): Atlas => ({
  width,
  height,
  texels: Array.from({ length: width * height * layers }, () => [fill(), fill(), fill(), fill()]),
})
const at = (a: Atlas, [x, y]: number[], layer: number) => (layer * a.height + y) * a.width + x

test('after the follow-up, the snapshot is the probes, word for word', () => {
  const r = random(7),
    side = 3,
    levels = 2,
    width = side * PROBE_TEXELS,
    height = side * side
  for (const queueLength of [1, 5, 54, 70]) {
    const probes = atlas(width, height, levels, () => r())
    const snapshot = { ...probes, texels: probes.texels.map((t) => [...t]) }
    // Where each entry's probe lies: `queuedProbe`, shared by the update and the follow-up (the
    // test below holds both to it), stands here for any address; one entry in seven is invalid.
    const queued = Array.from({ length: queueLength }, (_, entry) => ({
      valid: entry % 7 !== 3,
      probe: [
        Math.floor(r() * side) * PROBE_TEXELS,
        Math.floor(r() * height),
        Math.floor(r() * levels),
      ],
    }))
    const run = shaderRun<{ followSnapshot: (id: number[]) => void }>(
      BOUNCE_SNAPSHOT_SHADER,
      ['followSnapshot'],
      {
        ...wgslConstants(BOUNCE_SNAPSHOT_SHADER),
        bounce: {
          counts: [side, levels, side ** 3, side ** 3 * levels],
          frame: [1, queueLength, 1, 0],
        },
        snapshotOut: snapshot,
        probes,
        // The entry of a texel's thread is a `u32` quotient in the kernel: truncated here.
        queuedProbe: (entry: number) => queued[Math.floor(entry)],
        textureLoad: (a: Atlas, xy: number[], layer: number) => [...a.texels[at(a, xy, layer)]],
        textureStore: (a: Atlas, xy: number[], layer: number, v: number[]) =>
          void (a.texels[at(a, xy, layer)] = [...v]),
      },
    )
    // The update: each valid probe the queue names takes new words in its texels (`probeStore`).
    for (const { valid, probe } of queued)
      for (let k = 0; valid && k < PROBE_TEXELS; k++)
        probes.texels[at(probes, [probe[0] + k, probe[1]], probe[2])] = [r(), r(), r(), r()]
    assert.notDeepEqual(snapshot.texels, probes.texels, 'the update wrote')
    // Every thread the host dispatches, a texel each, those past the queue included.
    for (
      let id = 0;
      id < ceilDiv(queueLength * PROBE_TEXELS, BOUNCE_WORKGROUP) * BOUNCE_WORKGROUP;
      id++
    )
      run.followSnapshot([id, 0, 0])
    assert.deepEqual(snapshot.texels, probes.texels, `${queueLength} probes queued`)
  }
})

test('the update stores only the texels of the queued probe the follow-up copies', () => {
  // One addressing text in both modules: the same entry names the same probe.
  const start = BOUNCE_PROBE_SHADER.indexOf('struct QueuedProbe'),
    queued = BOUNCE_PROBE_SHADER.slice(start, BOUNCE_PROBE_SHADER.indexOf('\n}', start) + 2)
  assert.ok(
    start >= 0 && queued.includes('fn queuedProbe(') && BOUNCE_SNAPSHOT_SHADER.includes(queued),
  )
  assert.match(BOUNCE_SNAPSHOT_SHADER, /let entry=id\.x\/PROBE_VECTORS;/)
  assert.match(BOUNCE_SNAPSHOT_SHADER, /let queued=queuedProbe\(entry\);/)
  const body = BOUNCE_PROBE_SHADER.split('fn updateProbes(')[1]
  // The probe it writes is the queue's, by the same function the follow-up calls.
  assert.match(body, /let queued=queuedProbe\(group\.x\);\n if\(!queued\.valid\)\{return;\}/)
  assert.match(body, /let probe=queued\.probe;/)
  // Its stores: vectors 0 to 8, then the two distance vectors — all below `PROBE_VECTORS`.
  const stores = [...body.matchAll(/probeStore\(probe,(\w+),/g)].map((m) => m[1])
  assert.deepEqual(stores, ['k', 'PROBE_DISTANCE_POSITIVE', 'PROBE_DISTANCE_NEGATIVE'])
  assert.match(body, /for\(var k=0u;k<9u;k\+\+\)\{\n {2}let kept=/)
  const constants = wgslConstants(BOUNCE_PROBE_SHADER) as Record<string, number>
  assert.deepEqual(
    [constants.PROBE_DISTANCE_POSITIVE, constants.PROBE_DISTANCE_NEGATIVE, constants.PROBE_VECTORS],
    [9, 10, PROBE_TEXELS],
  )
  assert.equal(PROBE_TEXELS, 11)
})

test('a working image copies no atlas: one bounce pass sweeps, updates, then the snapshot follows', async () => {
  const gpu = fakeDevice({
    limits: { maxStorageBufferBindingSize: 1 << 30, maxBufferSize: 1 << 30 },
  })
  const lights = gpu.device.createBuffer({ size: 64, usage: GPUBufferUsage.STORAGE })
  const probes = await createGpuBounceProbes(gpu.device, floorProxy(8, 4), () => lights, 1000)
  const work: string[] = []
  let entry = ''
  const encoder = {
    copyTextureToTexture: () => void work.push('copy'),
    beginRenderPass: (d: GPURenderPassDescriptor) => (
      work.push(`clear ${[...d.colorAttachments].length}`),
      { end() {} }
    ),
    beginComputePass: ({ label }: GPUComputePassDescriptor) => (
      work.push(`pass ${label}`),
      {
        setPipeline: (p: { entryPoint: string }) => (entry = p.entryPoint),
        setBindGroup() {},
        dispatchWorkgroups: (x: number) => void work.push(`${entry} ${x}`),
        end() {},
      }
    ),
  } as unknown as GPUCommandEncoder
  assert.equal(probes.encode(encoder, 1, [4, 4, 2]), true)
  const groups = probes.lastProbes
  assert.ok(groups > 0)
  assert.equal(work.includes('copy'), false, 'no copy of the atlas')
  // One pass: the surface cache's sweep, the probes' update, the snapshot's follow-up.
  const at = work.indexOf(`pass ${BOUNCE_PASS}`)
  assert.deepEqual(
    work.slice(at).map((step) => step.split(' ')[0]),
    ['pass', 'updateSurface', 'updateProbes', 'followSnapshot'],
  )
  assert.deepEqual(work.slice(at + 2), [
    `updateProbes ${groups}`,
    `followSnapshot ${ceilDiv(groups * PROBE_TEXELS, BOUNCE_WORKGROUP)}`,
  ])
  probes.dispose()
})
