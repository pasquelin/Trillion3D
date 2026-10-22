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
import { DEG2RAD } from '../../../../math/src/constants.ts'
import { createScreenProbeParams, screenProbeFlags } from './screen/params.ts'
import {
  SCREEN_PROBE_FLAGS,
  SCREEN_PROBE_PARAMS,
  SCREEN_PROBE_PARAMS_BYTES,
  screenProbeGeometry,
} from './screen/screenProbeLayout.ts'
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

test('the screen probes flags say what each image can read: the screen, the history, the field, the vectors, the switches of its level', () => {
  const F = SCREEN_PROBE_FLAGS
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const all = {
    frame: 1,
    history: true,
    screen: true,
    field: true,
    velocity: true,
    previousInverse: identity,
  }
  const ultra = screenProbeSettings()
  assert.equal(
    screenProbeFlags(ultra, all),
    F.screenTraces |
      F.importance |
      F.importanceLighting |
      F.radianceHistory |
      F.temporal |
      F.field |
      F.occlusion |
      F.sceneTraces |
      F.velocity,
  )
  const high = screenProbeSettings({ screenProbes: 'high' })
  assert.equal(
    screenProbeFlags(high, all) & (F.stochastic | F.octahedral),
    F.stochastic | F.octahedral,
  )
  // The light the rays follow and the history it comes from are two settings of the importance sampling.
  const lit = (options: Parameters<typeof screenProbeSettings>[0]) =>
    screenProbeFlags(screenProbeSettings(options), all) &
    (F.importance | F.importanceLighting | F.radianceHistory)
  assert.equal(
    lit({ screenProbeImportanceIncomingLighting: false }),
    F.importance | F.radianceHistory,
  )
  assert.equal(lit({ screenProbeProbeRadianceHistory: false }), F.importance | F.importanceLighting)
  assert.equal(lit({ screenProbeImportanceSampling: false }), 0)
})

test('the screen probes flags leave out what an image has not: no history, no vectors; and the temporal, detail and clamp switches follow the settings', () => {
  const F = SCREEN_PROBE_FLAGS
  const identity = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const all = {
    frame: 1,
    history: true,
    screen: true,
    field: true,
    velocity: true,
    previousInverse: identity,
  }
  const ultra = screenProbeSettings()
  const first = { ...all, frame: 0, history: false, screen: false, field: false }
  assert.equal(
    screenProbeFlags(ultra, first) &
      (F.screenTraces | F.radianceHistory | F.temporal | F.field | F.velocity),
    0,
    'no history, so neither its vectors',
  )
  assert.equal(
    screenProbeFlags(screenProbeSettings({ screenProbeTemporal: false }), all) & F.temporal,
    0,
  )
  // The detail trace needs the switch and a level that allows it, over the scene trace.
  const mesh = (options: Parameters<typeof screenProbeSettings>[0]) =>
    screenProbeFlags(screenProbeSettings(options), all) & (F.sceneTraces | F.meshTraces)
  assert.equal(mesh({}), F.sceneTraces, 'off by default')
  assert.equal(mesh({ screenProbeMeshTraces: true }), F.sceneTraces | F.meshTraces)
  assert.equal(mesh({ screenProbeMeshTraces: true, screenProbes: 'high' }), F.sceneTraces)
  assert.equal(mesh({ screenProbeMeshTraces: true, screenProbeSceneTraces: false }), 0)
  assert.equal(
    screenProbeFlags(screenProbeSettings({ screenProbeFastUpdateClamp: true }), all) &
      F.fastUpdateClamp,
    F.fastUpdateClamp,
  )
})

test('the screen probes parameters are the words of the settings and the image, and only the words that moved go up', () => {
  const held = new Uint32Array(SCREEN_PROBE_PARAMS.words)
  let sent = 0
  const device = {
    queue: {
      writeBuffer(_: unknown, __: number, image: Uint32Array, first: number, count: number) {
        held.set(image.subarray(first, first + count), first)
        sent += count
      },
    },
  } as unknown as GPUDevice
  const write = createScreenProbeParams(device, { size: SCREEN_PROBE_PARAMS_BYTES } as GPUBuffer)
  const settings = screenProbeSettings()
  const geometry = screenProbeGeometry(1920, 1080, settings)
  // The inverse of the last view-projection: its second column is (0, 2, 0, 0).
  const previousInverse = [1, 0, 0, 0, 0, 2, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
  const image = (frame: number) => ({
    frame,
    history: true,
    screen: true,
    field: true,
    velocity: true,
    previousInverse,
  })
  write(geometry, settings, image(11))
  const at = SCREEN_PROBE_PARAMS.at
  const words = (from: number, count = 4) => Array.from(held.subarray(from, from + count))
  const floats = (from: number) => Array.from(new Float32Array(held.buffer, from * 4, 4))
  assert.deepEqual(words(at.size), [1920, 1080, 16, 11])
  assert.deepEqual(words(at.grid), [120, 68, 102, 4080])
  assert.deepEqual(words(at.mode), [3, 2, screenProbeFlags(settings, image(11)), 3])
  assert.deepEqual(words(at.counts), [10, 8160, 50, 8])
  assert.deepEqual(floats(at.weights), [-10000, -1000, 0.1, 10].map(Math.fround))
  assert.deepEqual(floats(at.spatial), [1000, 10 * DEG2RAD, 1, 1].map(Math.fround))
  assert.deepEqual(floats(at.scene), [1.8, 40, 0.05, 0.01].map(Math.fround))
  assert.deepEqual(floats(at.motion), [0.005, 10, 0.9, 0].map(Math.fround))
  assert.deepEqual(floats(at.tuning), [4, 0.4, 0.005, 0.02].map(Math.fround))
  assert.deepEqual(floats(at.previous + 4), [0, 2, 0, 0], 'the second column of the last inverse')
  const first = sent
  write(geometry, settings, image(11))
  assert.equal(sent, first, 'an image the same as the last sends nothing')
  write(geometry, settings, image(12))
  assert.deepEqual(
    [words(at.size)[3], words(at.mode).slice(0, 2), words(at.mode)[3]],
    [12, [4, 3], 4],
  )
  assert.ok(
    sent - first < SCREEN_PROBE_PARAMS.words,
    'the words from the rank to the turn, not the whole uniform',
  )
})
