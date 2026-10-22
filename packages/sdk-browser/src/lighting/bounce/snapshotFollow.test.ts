// The probes' snapshot takes no copy of the whole atlas each image (2 × the atlas's bytes): it
// takes, by a dispatch of the probe pass after the update, the texels of the probes the
// queue names (`followSnapshot`). Run here on the shipped text over atlases of random words: after
// an update that writes the texels the update kernel stores, the snapshot equals the probes word
// for word — which is what the copy gave the next image to read.
import { WORKGROUP_THREADS } from '../../gpu/dispatch/grid.ts'
import test from 'node:test'
import assert from 'node:assert/strict'
import { shaderRun } from '../../materials/texture/shaderRun.fixture.ts'
import { wgslConstants } from '../../materials/texture/shaderRule.fixture.ts'
import { BOUNCE_PROBE_SHADER, BOUNCE_SNAPSHOT_SHADER, snapshotGroups } from './probes/probeWgsl.ts'
import { PROBE_TEXELS } from './atlas.ts'
import { ATLAS_CALLS, simulatedAtlas } from './atlas.fixture.ts'
import { lcgRandom } from '../../../../math/src/sequence/random.ts'
import { FLOOR_EYE, floorProbes } from './floorProbes.fixture.ts'
import { BOUNCE_LIGHT_LISTS_PASS, BOUNCE_PASS } from '../../diagnostic/stage/passLabels.ts'
import { screenProbeSettings } from '../../../../sdk-core/src/bounce/screenProbeOptions.fixture.ts'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'

test('after the follow-up, the snapshot is the probes, word for word', () => {
  const r = lcgRandom(7),
    side = 3,
    levels = 2,
    width = side * PROBE_TEXELS,
    height = side * side
  for (const queueLength of [1, 5, 54, 70]) {
    const probes = simulatedAtlas([width, height, levels], r)
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
      ['followSnapshot', 'probeTexel'],
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
        ...ATLAS_CALLS,
      },
    )
    // The update: each valid probe the queue names takes new words in its texels (`probeStore`).
    for (const { valid, probe } of queued)
      for (let k = 0; valid && k < PROBE_TEXELS; k++)
        ATLAS_CALLS.textureStore(probes, [probe[0] + k, probe[1]], probe[2], [r(), r(), r(), r()])
    assert.notDeepEqual(snapshot.texels, probes.texels, 'the update wrote')
    // Every thread the host dispatches, a texel each, those past the queue included.
    for (let id = 0; id < snapshotGroups(queueLength) * WORKGROUP_THREADS; id++)
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
  assert.match(BOUNCE_SNAPSHOT_SHADER, /let entry=id\.x\/PROBE_TEXELS;/)
  assert.match(BOUNCE_SNAPSHOT_SHADER, /let queued=queuedProbe\(entry\);/)
  const body = BOUNCE_PROBE_SHADER.split('fn updateProbes(')[1]
  // The probe it writes is the queue's, by the same function the follow-up calls.
  assert.match(body, /let queued=queuedProbe\(group\.x\);\n if\(!queued\.valid\)\{return;\}/)
  assert.match(body, /let probe=queued\.probe;/)
  // A probe taken for another cell, or for its first trace, keeps nothing of what its slot held.
  assert.match(
    body,
    /let held=!queued\.fresh&&all\(probeCell\(probe\)==cell\)&&probeLevel\(probe\)==level;/,
  )
  // Its stores: vectors 0 to 8, then the two distance vectors — all below `PROBE_TEXELS`.
  const stores = [...body.matchAll(/probeStore\(probe,(\w+),/g)].map((m) => m[1])
  assert.deepEqual(stores, ['k', 'PROBE_DISTANCE_POSITIVE', 'PROBE_DISTANCE_NEGATIVE'])
  assert.match(body, /for\(var k=0u;k<9u;k\+\+\)\{\n {2}let kept=/)
  const constants = wgslConstants(BOUNCE_PROBE_SHADER) as Record<string, number>
  assert.deepEqual(
    [constants.PROBE_DISTANCE_POSITIVE, constants.PROBE_DISTANCE_NEGATIVE, constants.PROBE_TEXELS],
    [9, 10, PROBE_TEXELS],
  )
  assert.equal(PROBE_TEXELS, 11)
})

test('a working image copies no atlas: one bounce pass updates, then the snapshot follows', async () => {
  const { gpu, probes, encoder, tiles } = await floorProbes(true)
  /** What the encoder took, in order: each compute pass by its label, then its dispatches by entry
   *  point and groups; every other command as the kit names it. */
  const workOf = () => {
    const log: string[] = []
    let next = 0
    for (const command of gpu.commands) {
      if (!command.startsWith('compute ')) {
        log.push(command)
        continue
      }
      const { label, commands } = gpu.computePasses[next++]
      log.push(`pass ${label}`)
      let entry = ''
      for (const [name, [x]] of commands) {
        if (name === 'setPipeline') entry = (x as { entryPoint: string }).entryPoint
        if (name === 'dispatchWorkgroups') log.push(`${entry} ${x}`)
      }
    }
    return log
  }
  assert.equal(probes.encode(encoder, 1, FLOOR_EYE), true)
  const groups = probes.lastProbes,
    work = workOf()
  assert.ok(groups > 0)
  assert.equal(gpu.textureCopies.length, 0, 'no copy of the atlas')
  // One pass: the table's writes (the probes the first update tells the shaders of come after them,
  // the entries of the cells named before the update reads the snapshot), the probes' update, the
  // snapshot's follow-up, the census of the field; then the census's counts copied for the CPU.
  const at = work.indexOf(`pass ${BOUNCE_PASS}`)
  assert.deepEqual(
    work.slice(at).map((step) => step.split(' ')[0]),
    ['pass', 'writeTable', 'updateProbes', 'followSnapshot', 'countField', 'copy'],
  )
  assert.deepEqual(work.slice(at + 1, -1), [
    `writeTable ${Math.ceil(probes.lastTexels / WORKGROUP_THREADS)}`,
    `updateProbes ${groups}`,
    `followSnapshot ${snapshotGroups(groups)}`,
    `countField ${Math.ceil((BOUNCE_SETTINGS.probePool + (BOUNCE_SETTINGS.cascadeLevels * BOUNCE_SETTINGS.cascadeSize ** 3) / 4) / WORKGROUP_THREADS)}`,
  ])
  // The world grid's lists before it, on the frame that lists them; a frame whose lights and
  // lattice did not change lists nothing again.
  assert.ok(
    work.indexOf(`pass ${BOUNCE_LIGHT_LISTS_PASS}`) < at &&
      work.includes(`pass ${BOUNCE_LIGHT_LISTS_PASS}`),
  )
  const before = work.length
  assert.equal(probes.encode(encoder, 1, FLOOR_EYE), true)
  assert.equal(workOf().slice(before).includes(`pass ${BOUNCE_LIGHT_LISTS_PASS}`), false)
  probes.dispose()
  tiles!.dispose()
})

test('the radiance cache of the probes queued is updated once the pass is over, by the screen probes after their importance or by the frame alone: the tiles, their trace over the list the tiles made, the filter; a level that casts none keeps no cache', async () => {
  const entries = (gpu: Awaited<ReturnType<typeof floorProbes>>['gpu'], pass: number) => {
    const log: string[] = []
    let entry = ''
    for (const [name, [x]] of gpu.computePasses[pass].commands) {
      if (name === 'setPipeline') entry = (x as { entryPoint: string }).entryPoint
      if (name.startsWith('dispatchWorkgroups'))
        log.push(`${entry}${name.endsWith('Indirect') ? ' (listed)' : ''}`)
    }
    return log
  }
  const { gpu, probes, encoder } = await floorProbes(true)
  assert.equal(probes.encode(encoder, 1, FLOOR_EYE), true)
  assert.equal(probes.cache.pending, true, 'the pass left the update to be made')
  assert.ok(probes.cache.views, 'the maps are made for a level that casts')
  const passes = gpu.computePasses.length
  probes.cache.flush(encoder)
  assert.equal(gpu.computePasses[passes].label, BOUNCE_PASS)
  assert.deepEqual(entries(gpu, passes), ['generateTiles', 'traceTiles (listed)', 'filterMaps'])
  assert.equal(probes.cache.pending, false, 'made once')
  // The screen probes give their importance in: the functions cleared, the scatter, then the tiles.
  assert.equal(probes.encode(encoder, 1, FLOOR_EYE), true)
  const scattered: string[] = []
  const pass = encoder.beginComputePass({ label: 'screen' })
  assert.equal(
    probes.cache.encode(pass, () => scattered.push('scatter')),
    true,
  )
  pass.end()
  assert.deepEqual(entries(gpu, gpu.computePasses.length - 1).slice(0, 2), [
    'clearPdf',
    'generateTiles',
  ])
  assert.deepEqual(scattered, ['scatter'])
  probes.dispose()
  // A level that casts no probe reads no cache: none is kept.
  const low = screenProbeSettings({ screenProbes: 'low' })
  const bare = await floorProbes(true, true, () => low)
  assert.equal(bare.probes.encode(bare.encoder, 1, FLOOR_EYE), true)
  assert.equal(bare.probes.cache.pending, false)
  assert.equal(bare.probes.cache.views, undefined)
  assert.equal(bare.probes.cache.bytes, 0)
  bare.probes.dispose()
})
