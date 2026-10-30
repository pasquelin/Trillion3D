import test from 'node:test'
import assert from 'node:assert/strict'
import { fakeDevice } from '../../../../../tests/kit/fakeDevice/fakeDevice.ts'
import { dropSubmitted, openEncoder } from '../../gpu/core/frameRetire.ts'
import { BUDGET_EXCEEDED } from '../../gpu/core/ledgerBooks.ts'
import {
  OIT_POOL_FLOOR,
  OIT_RETRY_FRAMES,
  oitPoolDraws,
  oitPoolMinimum,
  oitPoolWords,
  oitRefusalHolds,
} from './oitLayout.ts'
import {
  clearOitDemand,
  copyOitDemand,
  disposeOit,
  oitBuffersOf,
  oitBuffersAwaited,
  oitLayouts,
  oitPassGroups,
  type OitBuffers,
} from './oitResources.ts'

const PIXELS = 10_000
const SAMPLES = 4
const POOL = 'Trillion3D sorted translucency pool'

/** A device whose pool buffers above `limit` bytes are refused, as `how` says; the warnings it is told of are counted. */
function session(limit: number, how: 'oom' | 'throw' | 'budget' = 'oom') {
  const refusing = { limit }
  const gpu = fakeDevice({
    refuse: (descriptor) =>
      descriptor.label === POOL && (descriptor as GPUBufferDescriptor).size > refusing.limit
        ? how === 'budget'
          ? undefined
          : how
        : undefined,
  })
  if (how === 'budget') {
    const create = gpu.device.createBuffer.bind(gpu.device)
    Object.assign(gpu.device, {
      createBuffer(descriptor: GPUBufferDescriptor) {
        if (descriptor.label === POOL && descriptor.size > refusing.limit)
          throw Object.assign(new Error('budget'), { code: BUDGET_EXCEEDED })
        return create(descriptor)
      },
    })
  }
  const warnings: string[] = []
  const diagnostics: string[] = []
  const diagnose = (phase: string) => void diagnostics.push(phase)
  const warn = console.warn
  console.warn = (text: string) => void warnings.push(text)
  const owner = {}
  const encode = () => openEncoder(gpu.device, () => gpu.device.createCommandEncoder())
  /** One image: a new encoder, the buffers asked for it, the answers of the device awaited. */
  const image = async () => {
    const encoder = encode()
    const buffers = oitBuffersOf(gpu.device, owner, encoder, PIXELS, SAMPLES, diagnose)
    for (let wait = 0; wait < 6; wait++) await new Promise((resolve) => setImmediate(resolve))
    dropSubmitted(encoder)
    return buffers
  }
  const finish = () => {
    console.warn = warn
    disposeOit(gpu.device, owner)
  }
  return { gpu, owner, warnings, diagnostics, diagnose, refusing, image, encode, finish }
}

const poolBytes = (nodes: number) => oitPoolWords(PIXELS, SAMPLES, SAMPLES, nodes) * 4

/** The buffers the session holds once the first grant is adopted. */
async function started(s: ReturnType<typeof session>) {
  assert.equal(await s.image(), undefined)
  const buffers = await s.image()
  assert.ok(buffers)
  return buffers
}

test('the first buffers are not used before the device grants them, then the layers sort', async () => {
  const s = session(Infinity)
  try {
    // Nothing is held while the first buffers are asked of the device (`started` checks the first image has none).
    const buffers = await started(s)
    assert.equal(buffers.nodes, oitPoolMinimum(PIXELS))
    assert.equal(buffers.samples, SAMPLES)
  } finally {
    s.finish()
  }
})

test('a refused growth is drawn again at half the bytes and keeps what was granted, said once', async () => {
  const s = session(Infinity)
  try {
    const buffers = await started(s)
    const first = buffers.pool
    buffers.own.nodes = 400_000
    // The device grants pools of at most 8 MB: the pool asked for (about 10 MB) is refused, its half granted.
    s.refusing.limit = 8_000_000
    await s.image()
    const grown = await s.image()
    assert.ok(grown && grown.pool !== first)
    assert.ok(grown.nodes > oitPoolMinimum(PIXELS))
    assert.ok(poolBytes(grown.nodes) <= 8_000_000)
    assert.equal(s.warnings.length, 1)
    // The refusal lowered the cap: no more is asked for, and nothing is said again.
    const settled = grown.pool
    for (let frame = 0; frame < 5; frame++) assert.equal((await s.image())?.pool, settled)
    assert.equal(s.warnings.length, 1)
  } finally {
    s.finish()
  }
})

test('a growth the device refuses at every size keeps the old pool, and the session goes on', async () => {
  for (const how of ['oom', 'budget'] as const) {
    const s = session(Infinity, how)
    try {
      const buffers = await started(s)
      const pool = buffers.pool
      buffers.own.nodes = 400_000
      s.refusing.limit = 0
      for (let frame = 0; frame < 6; frame++) {
        const now = await s.image()
        assert.equal(now?.pool, pool, how)
        assert.equal(now?.nodes, oitPoolMinimum(PIXELS))
      }
      assert.equal(s.warnings.length, 1, how)
    } finally {
      s.finish()
    }
  }
})

test('a refusal is lifted after 60 images where the demand has grown, so the pool grows once the device allows it', async () => {
  const s = session(Infinity)
  try {
    const buffers = await started(s)
    buffers.own.nodes = 400_000
    s.refusing.limit = 0
    await s.image()
    assert.equal((await s.image())?.nodes, oitPoolMinimum(PIXELS))
    // The device recovers, the demand has grown past the one refused: the refusal does not last.
    s.refusing.limit = Infinity
    buffers.own.nodes = 800_000
    let now: OitBuffers | undefined
    for (let frame = 0; frame < OIT_RETRY_FRAMES + 4; frame++) now = await s.image()
    assert.ok(now && now.nodes > oitPoolMinimum(PIXELS))
  } finally {
    s.finish()
  }
})

test('a failing ask is a refusal: the asking ends, one warning, the pool in place stays', async () => {
  const s = session(Infinity, 'throw')
  try {
    const buffers = await started(s)
    const pool = buffers.pool
    buffers.own.nodes = 400_000
    s.refusing.limit = 0
    for (let frame = 0; frame < 6; frame++) assert.equal((await s.image())?.pool, pool)
    assert.equal(oitBuffersAwaited(s.owner), undefined)
    assert.equal(s.warnings.length, 1)
  } finally {
    s.finish()
  }
})

test('the first buffers refused at the floor lower the samples, and the sorting comes back after the retry', async () => {
  const s = session(0)
  try {
    assert.equal(await s.image(), undefined)
    for (let frame = 0; frame < 4; frame++) assert.equal(await s.image(), undefined)
    assert.ok(s.warnings.length >= 1)
    s.refusing.limit = Infinity
    let now: OitBuffers | undefined
    for (let frame = 0; frame < OIT_RETRY_FRAMES + 6 && !now; frame++) now = await s.image()
    assert.ok(now, 'the sorting returns after the refusal is lifted')
    assert.ok(now.samples <= SAMPLES)
  } finally {
    s.finish()
  }
})

test('each pass of an encoder reads a uniform buffer of its own, given back when the encoder is dropped, and a dropped image does not hold the next one', async () => {
  const s = session(Infinity)
  try {
    const buffers = await started(s)
    const { device } = s.gpu
    const first = s.encode()
    assert.ok(oitBuffersOf(device, s.owner, first, PIXELS, SAMPLES, s.diagnose))
    const a = oitPassGroups(device, buffers, first, undefined, 100, 0.05, 0)
    copyOitDemand(first, buffers)
    // The second pass of the same image: the same image (the passes are kept), another buffer.
    assert.ok(oitBuffersOf(device, s.owner, first, PIXELS, SAMPLES, s.diagnose))
    assert.equal(buffers.own.passes, 1)
    const b = oitPassGroups(device, buffers, first, undefined, 100, 0.05, 0)
    assert.notEqual(a.collect, b.collect)
    // The image is dropped without a submit: the next encoder is a new image, whatever the last one did.
    dropSubmitted(first)
    const second = s.encode()
    assert.ok(oitBuffersOf(device, s.owner, second, PIXELS, SAMPLES, s.diagnose))
    assert.equal(buffers.own.passes, 0)
    const cleared = s.gpu.clears.length
    clearOitDemand(second, buffers)
    assert.equal(s.gpu.clears.length, cleared + 1)
    // Its first pass takes a freed buffer again: the groups made for it are found.
    const c = oitPassGroups(device, buffers, second, undefined, 100, 0.05, 0)
    assert.equal(c.collect, a.collect)
    dropSubmitted(second)
  } finally {
    s.finish()
  }
})

test('the folded collect layout is the combination layout', () => {
  const { device } = fakeDevice()
  assert.equal(oitLayouts(device).foldedCollect, oitLayouts(device).combine)
})

test('the pools asked of the device halve down to the floor, and a growth takes none that is not larger', () => {
  const drawn = [...oitPoolDraws(PIXELS, SAMPLES, SAMPLES, 400_000, OIT_POOL_FLOOR)].map(
    (d) => d.nodes,
  )
  assert.equal(drawn[0], 400_000)
  assert.equal(drawn.at(-1), OIT_POOL_FLOOR)
  drawn.slice(1).forEach((nodes, at) => assert.ok(nodes < drawn[at]!))
  assert.ok(drawn.every((nodes) => nodes >= OIT_POOL_FLOOR))
  // A growth from a pool of 100000: the floor is the pool held.
  const growth = [...oitPoolDraws(PIXELS, SAMPLES, SAMPLES, 400_000, 100_000)].map((d) => d.nodes)
  assert.equal(growth.at(-1), 100_000)
  assert.ok(growth.length >= 2)
})

test('a refusal holds for the same extent until 60 images pass with the pool spent, and never past an extent change', () => {
  const refusal = { pixels: 100, frame: 10 }
  assert.equal(oitRefusalHolds(undefined, 100, 11, 99, true), false)
  assert.equal(oitRefusalHolds(refusal, 100, 11, 99, true), true)
  assert.equal(oitRefusalHolds(refusal, 200, 11, 0, true), false)
  // The count stops at the pool: only the pool spent for 60 frames in a row says the sorting wants more.
  assert.equal(oitRefusalHolds(refusal, 100, 10 + OIT_RETRY_FRAMES, 59, true), true)
  assert.equal(oitRefusalHolds(refusal, 100, 10 + OIT_RETRY_FRAMES, 60, true), false)
  // With no buffers held nothing sorts and the pool cannot be spent: the clock alone lifts it.
  assert.equal(oitRefusalHolds(refusal, 100, 10 + OIT_RETRY_FRAMES, 0, false), false)
})

const HEAD = 'Trillion3D sorted translucency head'
const settle = async () => {
  for (let wait = 0; wait < 8; wait++) await new Promise((resolve) => setImmediate(resolve))
}
/** The head buffers made and destroyed on a device, counted by their label. */
function headsOf(s: ReturnType<typeof session>) {
  let made = 0
  const create = s.gpu.device.createBuffer.bind(s.gpu.device)
  Object.assign(s.gpu.device, {
    createBuffer(descriptor: GPUBufferDescriptor) {
      if (descriptor.label === HEAD) made++
      return create(descriptor)
    },
  })
  return {
    made: () => made,
    destroyed: () => s.gpu.destroyed.filter((resource) => resource.label === HEAD).length,
  }
}

test('the first buffers are waited for by the frame while they are asked, and not once granted or refused', async () => {
  const s = session(Infinity)
  try {
    assert.equal(oitBuffersAwaited(s.owner), undefined)
    const encoder = s.encode()
    assert.equal(
      oitBuffersOf(s.gpu.device, s.owner, encoder, PIXELS, SAMPLES, s.diagnose),
      undefined,
    )
    const pending = oitBuffersAwaited(s.owner)
    assert.ok(pending)
    await pending
    assert.equal(oitBuffersAwaited(s.owner), undefined)
    dropSubmitted(encoder)
    // A growth keeps the sorting going: the frames do not wait for it.
    const buffers = await s.image()
    assert.ok(buffers)
    buffers.own.nodes = 400_000
    await s.image()
    assert.equal(oitBuffersAwaited(s.owner), undefined)
  } finally {
    s.finish()
  }
})

test('a pool refused by the device is drawn smaller through the engine grant and told as a gpu-out-of-memory diagnostic', async () => {
  const s = session(Infinity)
  try {
    const buffers = await started(s)
    buffers.own.nodes = 400_000
    s.refusing.limit = 8_000_000
    await s.image()
    await s.image()
    assert.deepEqual(s.diagnostics, ['gpu-out-of-memory'])
  } finally {
    s.finish()
  }
})

test('a pool refused by a failure that is no refusal leaves no head buffer behind', async () => {
  const s = session(0, 'throw')
  try {
    const heads = headsOf(s)
    await s.image()
    await settle()
    assert.ok(heads.made() >= 1)
    assert.equal(heads.destroyed(), heads.made())
  } finally {
    s.finish()
  }
})

test('a view given back during its ask destroys what lands, counts no refusal, says nothing, and is not asked twice', async () => {
  const s = session(Infinity)
  try {
    const heads = headsOf(s)
    const encoder = s.encode()
    assert.equal(
      oitBuffersOf(s.gpu.device, s.owner, encoder, PIXELS, SAMPLES, s.diagnose),
      undefined,
    )
    disposeOit(s.gpu.device, s.owner)
    // The view asks again at once: the ask in flight is waited for, no second one is made.
    const again = s.encode()
    assert.equal(oitBuffersOf(s.gpu.device, s.owner, again, PIXELS, SAMPLES, s.diagnose), undefined)
    assert.equal(oitBuffersAwaited(s.owner), undefined)
    assert.equal(heads.made(), 1)
    await settle()
    assert.equal(heads.destroyed(), 1)
    assert.equal(s.warnings.length, 0)
    dropSubmitted(encoder)
    dropSubmitted(again)
  } finally {
    s.finish()
  }
  // Refused after the view was given back: not a refusal of the view, nor the warning of the device.
  const refused = session(0)
  try {
    const encoder = refused.encode()
    oitBuffersOf(refused.gpu.device, refused.owner, encoder, PIXELS, SAMPLES, refused.diagnose)
    disposeOit(refused.gpu.device, refused.owner)
    await settle()
    assert.equal(refused.warnings.length, 0)
    dropSubmitted(encoder)
  } finally {
    refused.finish()
  }
})

test('samples lowered after a refusal are asked again once the refusal lifts', async () => {
  const s = session(Infinity)
  try {
    const buffers = await started(s)
    assert.equal(buffers.samples, SAMPLES)
    // The buffers held keep fewer samples than were asked, as after a refusal at the floor: the device now grants more.
    const lowered = Object.assign(buffers, { samples: 1, asked: SAMPLES })
    assert.equal(lowered.samples, 1)
    let now: OitBuffers | undefined
    for (let frame = 0; frame < 6 && now?.samples !== SAMPLES; frame++) now = await s.image()
    assert.equal(now?.samples, SAMPLES)
  } finally {
    s.finish()
  }
})
