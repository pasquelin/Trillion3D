// The records of the translucent surfaces' own shadow (`objectShadowSelf.ts`): one per (subject, material) pair however many there are, the item table naming each
// by its first texel, and, in the packed read, the subject's rectangle copied once into the table's atlas rows.
import test from 'node:test'
import assert from 'node:assert/strict'
import { installGpuGlobals } from '../../../../../tests/kit/fakeDevice/globals.ts'
import {
  OBJECT_SHADOW_PACKED_LAYER_ROWS,
  OBJECT_SHADOW_PACKED_WIDTH as WIDTH,
  OBJECT_SHADOW_RECORD_TEXELS,
  OBJECT_SHADOW_RECORD_WORDS,
  type ObjectShadowAtlasRead,
} from '../../gpu/core/objectShadowRead.ts'
import {
  objectShadowReadResources,
  objectShadowTableAwaited,
  publishObjectShadowRead,
  releaseObjectShadowRead,
} from './objectShadowSelf.ts'
import { packedTableSize } from './objectShadowTable.ts'
import { deviceAnswering } from '../../frame/loop/deviceAnswer.ts'
import { heldOnAnswer } from '../../frame/loop/deviceAnswer.fixture.ts'

installGpuGlobals()

/** The light profiles' texture the tests fold: one object, so that a copy of it is told from a new texture. */
const PROFILES = {}

interface Written {
  rows: number
  words: Uint32Array
}

function setup(
  read: ObjectShadowAtlasRead,
  subjects: number,
  more: { maxBufferSize?: number; pop?: () => Promise<unknown> } = {},
) {
  const written: Written[] = []
  const created: { size: number[] }[] = []
  const copies: string[] = []
  const submits: number[] = []
  const device = {
    createTexture: (d: { size: number[] }) => {
      created.push(d)
      return { createView: () => ({}), destroy() {} }
    },
    createBuffer: (d: { size: number }) => ({ size: d.size, destroy() {} }),
    limits: {
      maxTextureDimension2D: 8192,
      maxTextureArrayLayers: 256,
      maxBufferSize: more.maxBufferSize ?? 2 ** 28,
    },
    pushErrorScope: () => {},
    popErrorScope: more.pop ?? (() => Promise.resolve(null)),
    createCommandEncoder: () => ({ ...encoder, finish: () => ({}) }),
    queue: {
      submit: () => submits.push(1),
      writeTexture: (_t: unknown, data: Uint32Array, _layout: unknown, size: number[]) =>
        written.push({ rows: size[1]!, words: data.slice(0) }),
    },
  } as unknown as GPUDevice
  const encoder = {
    copyTextureToBuffer: (_s: unknown, d: { offset: number }) => copies.push(`out ${d.offset}`),
    copyBufferToTexture: (_s: unknown, d: { origin: { y: number } }) =>
      copies.push(`in ${d.origin.y}`),
  } as unknown as GPUCommandEncoder
  const diagnostics: unknown[][] = []
  const rt = {
    gpu: {},
    run: { frame: 1 },
    vis: { blendPipelines: { objectShadowRead: read } },
    diag: { engineDiagnostic: (...args: unknown[]) => diagnostics.push(args) },
  } as never
  const projection = {
    directional: true,
    resolutionX: 6,
    resolutionY: 4,
    border: 2,
    invMaxSubjectDepth: 1,
    translatedWorldToClipInner: new Float64Array(16).fill(1),
    preShadowTranslation: [0, 0, 0],
    shadowBounds: { minX: 0, minY: 0, maxX: 1, maxY: 1 },
  }
  const frame = {
    subjects: Array.from({ length: subjects }, (_, k) => ({
      lightId: 1,
      place: k,
      fade: 1,
      projection,
    })),
    suns: new Map([[1, { direction: [0, -1, 0], slot: 0 }]]),
    atlases: {
      slots: Array.from({ length: subjects }, () => ({ atlas: 0, x: 3, y: 5 })),
      atlases: [{ side: 64, layer: 0 }],
      texture: {},
      array: {},
    },
  } as never
  return { written, created, copies, submits, diagnostics, device, encoder, rt, frame }
}

type Setup = ReturnType<typeof setup>
const nextFrame = (s: Setup) => ((s.rt as unknown as { run: { frame: number } }).run.frame += 1)
const settle = () => new Promise((resolve) => setImmediate(resolve))

/** The table is made aside, never used before the device grants it: asked once, the grant let to settle, the next image adopts it. */
async function adopt(s: Setup, items: ReturnType<typeof input>) {
  assert.equal(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items), false)
  await settle()
  nextFrame(s)
}

const input = (count: number, per: (i: number) => number) => ({
  casting: Uint32Array.from({ length: count }, (_, i) => i + 1),
  count,
  materialRank: per,
  materialWords: new Float32Array(64 * 12),
})

test('there is a record for every pair of the frame, past any former cap, and every item names its own', async () => {
  const s = setup('texture', 1)
  // 300 items of one caster, each a material of its own.
  const count = 300
  const items = input(count, (i) => i)
  items.casting.fill(1)
  items.materialWords = new Float32Array(count * 12)
  await adopt(s, items)
  assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items))
  const { words, rows } = s.written[0]!
  // The item table takes the first row; the records follow it, a texel run each.
  const recordsAt = WIDTH * 4
  assert.equal(rows, 1 + Math.ceil((count * OBJECT_SHADOW_RECORD_TEXELS) / WIDTH))
  const first = new Set<number>()
  for (let i = 0; i < count; i++) {
    const named = words[i]! - 1
    assert.equal(named, WIDTH + i * OBJECT_SHADOW_RECORD_TEXELS)
    first.add(named)
  }
  assert.equal(first.size, count)
  // The last record is written: its place word names the atlas corner.
  const last = recordsAt + (count - 1) * OBJECT_SHADOW_RECORD_WORDS
  assert.equal(words[last + 42], 3)
  assert.equal(words[last + 43], 5)
  releaseObjectShadowRead({})
})

test('the packed read copies a subject’s rectangle once, whatever its records, into rows after the records', async () => {
  const s = setup('packed', 1)
  const items = input(2, (i) => i)
  items.casting.fill(1)
  await adopt(s, items)
  assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items))
  const { words } = s.written[0]!
  // Two layers of the rectangle, each out to the staging buffer and in to the table, once for the two records.
  assert.equal(s.copies.length, 4)
  // The records name the same copy: the row after the item and record rows, then the height of the plane.
  const at = (r: number) => WIDTH * 4 + r * OBJECT_SHADOW_RECORD_WORDS + 44
  assert.equal(words[at(0)], 2)
  assert.equal(words[at(1)], 2)
  // Each plane goes through the start of the staging buffer, one after the other.
  assert.deepEqual(s.copies, ['out 0', 'in 2', 'out 0', `in ${2 + 8}`])
  releaseObjectShadowRead({})
})

test('the table is rewritten only where it moved, and grows with the frame', async () => {
  const s = setup('texture', 1)
  const items = input(2, () => 0)
  items.casting.fill(1)
  await adopt(s, items)
  publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items)
  publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items)
  assert.equal(s.written.length, 1, 'a still frame writes nothing')
  assert.equal(s.created.length, 1)
  releaseObjectShadowRead({})
})

test('the folded read keeps a header row first, the records after it, then the profiles, and the atlas rectangles last', async () => {
  const s = setup('folded', 1)
  // Two slices of 16 texels a side: a row is 32 bytes, held in a row of 256 bytes.
  const rt = s.rt as unknown as { lights: unknown }
  rt.lights = {
    lightProfile: {
      atlas: { figures: () => ({ texture: PROFILES, side: 16, slices: 2, writes: 1 }) },
    },
  }
  const items = input(2, (i) => i)
  items.casting.fill(1)
  await adopt(s, items)
  assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items))
  // The items go up below the header row, the records past the profiles, then the header texel.
  const header = s.written[2]!.words
  // The profiles' bytes at row 1 + 1 (header, item row; none of the records moves them): 2 * 16 * 256 bytes, less than a row of the table, so one partial copy; the records and the atlas rectangles (2 planes of 8 rows) after them.
  assert.deepEqual([...header], [2, 16, 128, 2, 0, 0, 0, 0])
  // The two planes of the rectangle out and in, then the profiles through a buffer.
  assert.deepEqual(s.copies.slice(-2), ['out 0', 'in 2'])
  assert.deepEqual(s.copies.slice(0, 2), ['out 0', 'in 4'])
  // The profiles are copied once: a second image with the same atlas copies the rectangle only.
  s.copies.length = 0
  publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items)
  assert.equal(s.copies.length, 4)
  releaseObjectShadowRead({})
})

test('a rectangle wider than the table is cut into blocks, and a table past a layer goes on in the next', async () => {
  const s = setup('packed', 1)
  const frame = s.frame as unknown as {
    subjects: { projection: { resolutionX: number; resolutionY: number } }[]
  }
  // 2 * WIDTH + 100 texels across, two blocks of columns each with its two planes; a copy of rows is cut where a layer of the table ends.
  Object.assign(frame.subjects[0]!.projection, { resolutionX: 2 * WIDTH * 2 + 96, resolutionY: 1 })
  const items = input(1, () => 0)
  items.casting.fill(1)
  await adopt(s, items)
  assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items))
  // Three blocks (2 * WIDTH texels each, the last the rest), each two planes out and in.
  assert.equal(s.copies.length, 3 * 2 * 2)
  releaseObjectShadowRead({})
})

test('the table is sized to the rows, in whole layers past one, within the device’s layers', () => {
  assert.deepEqual(packedTableSize(10, 0, 256), { size: [WIDTH, 10, 1], rows: 10 })
  assert.deepEqual(packedTableSize(10, 100, 256), { size: [WIDTH, 150, 1], rows: 150 })
  assert.deepEqual(packedTableSize(5000, 0, 256), {
    size: [WIDTH, OBJECT_SHADOW_PACKED_LAYER_ROWS, 2],
    rows: 2 * OBJECT_SHADOW_PACKED_LAYER_ROWS,
  })
  assert.equal(packedTableSize(5000, 0, 1).size[2], 1)
})

test('a view that loses its shadow context keeps the table of the light profiles: only the records go', async () => {
  const s = setup('folded', 1)
  const rt = s.rt as unknown as { lights: unknown; blendState: unknown; gpu: object }
  rt.lights = {
    lightProfile: {
      atlas: { figures: () => ({ texture: PROFILES, side: 16, slices: 2, writes: 1 }) },
    },
  }
  rt.blendState = { blendGpu: new Array(3) }
  const items = input(1, () => 0)
  items.casting.fill(1)
  await adopt(s, items)
  publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items)
  const made = s.created.length
  releaseObjectShadowRead(rt.gpu, true)
  ;(s.rt as unknown as { run: { frame: number } }).run.frame = 2
  const resources = objectShadowReadResources(s.rt, s.device)
  assert.ok(resources?.packed)
  assert.equal(s.created.length, made, 'the table stays, none is made again')
  // The records went, but the profiles' rows lie before them and stayed: nothing is copied or submitted again.
  assert.equal(s.submits.length, 0)
  ;(s.rt as unknown as { run: { frame: number } }).run.frame = 3
  objectShadowReadResources(s.rt, s.device)
  assert.equal(s.submits.length, 0, 'a still image copies and submits nothing')
  assert.equal(s.created.length, made)
  releaseObjectShadowRead(rt.gpu)
})

test('the rectangles lie side by side along a shelf of the table, not one row run each', async () => {
  const s = setup('packed', 2)
  const items = input(2, () => 0)
  await adopt(s, items)
  assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items))
  const { words } = s.written[0]!
  const at = (r: number, w: number) => WIDTH * 4 + r * OBJECT_SHADOW_RECORD_WORDS + w
  // Both start at the same row, the second 5 texels across (10 texels of the atlas, two to a texel).
  assert.equal(words[at(1, 44)], words[at(0, 44)])
  assert.equal(words[at(0, 45)], 0)
  assert.equal(words[at(1, 45)], 5)
  // The table holds one rectangle's rows (2 planes of 8), not two.
  assert.equal(s.created[0]!.size[1], 1 + 1 + 16)
  releaseObjectShadowRead({})
})

test('a rectangle goes through the staging buffer in bands that fit the device’s buffer size', async () => {
  const s = setup('packed', 1, { maxBufferSize: 1024 })
  const items = input(1, () => 0)
  await adopt(s, items)
  assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items))
  // 256 bytes a row, 4 rows a band: 2 planes of 8 rows are 2 bands each, out and in.
  assert.equal(s.copies.length, 2 * 2 * 2)
  releaseObjectShadowRead({})
})

test('a table the device cannot make leaves the one the view had, and is not asked again each image', async () => {
  let failing = false
  const s = setup('texture', 1, {
    pop: () => Promise.resolve(failing ? ({ message: 'oom' } as unknown) : null),
  })
  try {
    const small = input(2, () => 0)
    await adopt(s, small)
    assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, small))
    failing = true
    const big = input(20000, () => 0)
    big.casting.fill(1)
    nextFrame(s)
    publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, big)
    await settle()
    nextFrame(s)
    const made = s.created.length
    // The rows asked do not fit the table kept: nothing is bound, and no other is made.
    assert.equal(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, big), false)
    assert.equal(s.created.length, made)
    assert.equal(s.diagnostics.length, 1)
    assert.equal(s.diagnostics[0]![0], 'gpu-out-of-memory')
    // The rows that fit the table kept are served by it.
    assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, small))
  } finally {
    releaseObjectShadowRead({})
  }
})

test('the table made aside is not used before the device grants it, nor are two asked at once', async () => {
  let grant: (error: unknown) => void = () => {}
  const s = setup('texture', 1, { pop: () => new Promise((resolve) => (grant = resolve)) })
  try {
    const items = input(2, () => 0)
    assert.equal(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items), false)
    const bigger = input(20000, () => 0)
    bigger.casting.fill(1)
    nextFrame(s)
    assert.equal(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, bigger), false)
    assert.equal(s.created.length, 1, 'one grow in flight, the next waits for it')
    grant(null)
    await settle()
    assert.equal(
      publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items),
      false,
      'granted, but adopted at the start of the next image',
    )
    nextFrame(s)
    assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items))
  } finally {
    releaseObjectShadowRead({})
  }
})

test('a refusal records the size that failed, and the exact rows asked are tried before any margin', async () => {
  const limit = { rows: Infinity }
  const sizes: number[] = []
  const s: Setup = setup('texture', 1, {
    pop: () => {
      const rows = s.created.at(-1)!.size[1]!
      sizes.push(rows)
      return Promise.resolve(rows > limit.rows ? ({ message: 'oom' } as unknown) : null)
    },
  })
  try {
    // Ten rows of items: a table of eleven rows or so.
    const held = input(10 * 16384, () => 0)
    await adopt(s, held)
    assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, held))
    const rows = s.created.at(-1)!.size[1]!
    // One row more: half again over the rows held is asked first and refused, the exact rows are then asked and granted.
    const more = input(11 * 16384, () => 0)
    limit.rows = rows + 1
    nextFrame(s)
    assert.equal(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, more), false)
    await settle()
    assert.ok(sizes.at(-1)! > rows + 1, 'the margin was asked first')
    nextFrame(s)
    assert.equal(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, more), false)
    await settle()
    assert.equal(sizes.at(-1), rows + 1, 'then the exact rows')
    nextFrame(s)
    assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, more))
  } finally {
    releaseObjectShadowRead({})
  }
})

test('the profiles lie before the records: a second publication of the image copies and submits nothing more', async () => {
  const s = setup('folded', 1)
  const rt = s.rt as unknown as { lights: unknown; blendState: unknown }
  rt.lights = {
    lightProfile: {
      atlas: { figures: () => ({ texture: PROFILES, side: 16, slices: 2, writes: 1 }) },
    },
  }
  rt.blendState = { blendGpu: new Array(2) }
  const items = input(2, (i) => i)
  items.casting.fill(1)
  await adopt(s, items)
  // The profiles alone first, then the depth pass's records in the same image.
  assert.ok(objectShadowReadResources(s.rt, s.device)?.packed)
  assert.equal(s.submits.length, 1)
  const profileCopies = () => s.copies.filter((c) => c === 'in 2').length
  const copied = profileCopies()
  assert.ok(copied > 0)
  assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items))
  assert.equal(s.submits.length, 1, 'no second command buffer')
  assert.equal(profileCopies(), copied, 'the profiles are not copied again')
  releaseObjectShadowRead({})
})

test('the profiles go through the staging buffer in bands that fit the device’s buffer size', async () => {
  const s = setup('folded', 1, { maxBufferSize: 1024 })
  const rt = s.rt as unknown as { lights: unknown; blendState: unknown }
  rt.lights = {
    lightProfile: {
      atlas: { figures: () => ({ texture: PROFILES, side: 16, slices: 2, writes: 1 }) },
    },
  }
  rt.blendState = { blendGpu: new Array(2) }
  const items = input(2, (i) => i)
  items.casting.fill(1)
  await adopt(s, items)
  s.copies.length = 0
  objectShadowReadResources(s.rt, s.device)
  // 256 bytes a texture row, 4 rows a band: 2 slices of 16 rows are 8 bands, each out and in.
  assert.equal(s.copies.filter((c) => c.startsWith('out')).length, 8)
  assert.equal(s.copies.filter((c) => c.startsWith('in')).length, 8)
  releaseObjectShadowRead({})
})

test('the atlas rectangles are not copied again when the depth pass drew nothing new', async () => {
  const s = setup('packed', 1)
  const items = input(1, () => 0)
  await adopt(s, items)
  assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items))
  s.copies.length = 0
  assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items, false))
  assert.equal(s.copies.length, 0)
  assert.ok(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items, true))
  assert.equal(s.copies.length, 4)
  releaseObjectShadowRead({})
})

test('the frames wait for the table the records need (a device answer), until the device grants it', async () => {
  let grant: (error: unknown) => void = () => {}
  const s = setup('texture', 1, { pop: () => new Promise((resolve) => (grant = resolve)) })
  try {
    assert.equal(objectShadowTableAwaited(s.rt), undefined, 'nothing asked, nothing awaited')
    const items = input(2, () => 0)
    assert.equal(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items), false)
    const answer = objectShadowTableAwaited(s.rt)
    assert.ok(answer, 'the first table is awaited')
    grant(null)
    await answer
    assert.equal(objectShadowTableAwaited(s.rt), undefined, 'granted, no longer awaited')
    nextFrame(s)
    assert.ok(
      publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, items),
      'adopted at the next image',
    )
    const bigger = input(20000, () => 0)
    bigger.casting.fill(1)
    nextFrame(s)
    assert.equal(publishObjectShadowRead(s.rt, s.device, s.encoder, s.frame, bigger), false)
    assert.ok(objectShadowTableAwaited(s.rt), 'a growth the records do not fit in is awaited too')
  } finally {
    releaseObjectShadowRead({})
  }
})

test('the frame loop holds the next frames on the table the discovering frame asked, until it is granted', async () => {
  let grant: (error: unknown) => void = () => {}
  const s = setup('texture', 1, { pop: () => new Promise((resolve) => (grant = resolve)) })
  const rt = s.rt as unknown as { gpu: { device: GPUDevice }; run: { hold: { heldOn?: string } } }
  rt.gpu.device = s.device
  rt.run.hold = {}
  try {
    assert.equal(deviceAnswering(s.rt), false, 'nothing asked, nothing held')
    assert.equal(
      publishObjectShadowRead(
        s.rt,
        s.device,
        s.encoder,
        s.frame,
        input(2, () => 0),
      ),
      false,
    )
    assert.equal(deviceAnswering(s.rt), true)
    assert.equal(heldOnAnswer(s.rt), 'translucent object shadow table')
    grant(null)
    await objectShadowTableAwaited(s.rt)
    assert.equal(deviceAnswering(s.rt), false, 'granted: the frames are drawn again')
  } finally {
    releaseObjectShadowRead({})
  }
})
