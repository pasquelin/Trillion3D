// The toon profiles in the light buffer (`registry.ts`, `follow.ts`): a profile's row, the same row for the same profile, the rows written when the
// collection changes, a pattern slot a profile that wears images takes and the limits.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  TOON_PATTERN_SLOTS,
  TOON_PARAM,
  TOON_PROFILE_RESOLUTION,
  TOON_ROWS_AT,
  toonBufferWords,
  toonLayout,
} from '../../../../sdk-core/src/lighting/toonProfile/rows.ts'
import { followToonProfiles } from './follow.ts'
import { imageState } from './bake.ts'
import { releaseToonTables, toonTablesOf } from './buffer.ts'
import { destroyAllRetired } from '../../gpu/core/frameRetire.ts'
import {
  holdToonProfile,
  registeredToonProfiles,
  releaseToonProfile,
  toonProfileRow,
  toonShadowExtinctions,
} from './registry.ts'

const image = (id: string) => ({ isTexture: true, id, version: 0 }) as never
const layout = toonLayout(TOON_PROFILE_RESOLUTION)
;(globalThis as { GPUBufferUsage?: unknown }).GPUBufferUsage ??= { STORAGE: 128, COPY_DST: 8 }

/** A runtime's run record: its own image counter (`run.frame`), advanced by each of its renders whichever driver draws them. */
const run = { frame: 0 }

/** A device that records the writes to its buffers and the buffers it made. */
function recorder() {
  const writes: { offset: number; words: Uint32Array }[] = []
  const made: { size: number; destroyed: boolean }[] = []
  const device = {
    createBuffer: ({ size }: { size: number }) => {
      const buffer = {
        size,
        destroyed: false,
        destroy() {
          this.destroyed = true
        },
      }
      made.push(buffer)
      return buffer
    },
    queue: {
      writeBuffer: (_: unknown, offset: number, data: Uint32Array) =>
        writes.push({ offset, words: data }),
    },
  } as unknown as GPUDevice
  return { device, writes, made, rows: () => writes.filter((w) => w.offset === TOON_ROWS_AT * 4) }
}

test('a material that names no profile wears row 0, the default profile', () => {
  assert.equal(toonProfileRow(undefined), 0)
  assert.equal(toonProfileRow(null), 0)
})

test('a profile takes a row, the same row for the same profile whatever its fields are completed with', () => {
  const first = toonProfileRow({ diffuseIndirectScale: 0.3 })
  assert.equal(first, 1)
  assert.equal(toonProfileRow({ diffuseIndirectScale: 0.3, diffuseRampOffsetSize: 1 }), first)
  assert.equal(toonProfileRow({ diffuseIndirectScale: 0.4 }), 2)
  assert.equal(registeredToonProfiles().profiles.length, 2)
})

test('the toon buffer is a header alone for no row, and grows by whole rows and pattern slots', () => {
  assert.equal(toonBufferWords(layout, 0, 0), 4)
  assert.equal(toonBufferWords(layout, 4, 0) - toonBufferWords(layout, 2, 0), 2 * layout.rowWords)
  assert.equal(
    toonBufferWords(layout, 2, 2) - toonBufferWords(layout, 2, 0),
    2 * layout.patternWords,
  )
})

// A toon record, which holds the toon tables with the default profile's row (no profile named).
const toonRecord = { released: new Set<() => void>() }

test('the toon tables exist as long as a record is toon, whether it names a profile or not', () => {
  const { device, made, rows } = recorder()
  followToonProfiles(device, TOON_PROFILE_RESOLUTION, run)
  assert.equal(rows().length, 0, 'no record is toon: no row written')
  assert.equal(made[0].size, 16, 'a header alone')
  assert.equal(toonShadowExtinctions(), undefined)
  assert.equal(holdToonProfile(toonRecord, undefined, true), 0, 'the default profile’s row')
  assert.equal(registeredToonProfiles().users, 1)
})

test('the rows are written once for a buffer, the default profile’s first, and again when the collection grows', () => {
  const { device, writes, made, rows } = recorder()
  followToonProfiles(device, TOON_PROFILE_RESOLUTION, run)
  followToonProfiles(device, TOON_PROFILE_RESOLUTION, run)
  assert.equal(rows().length, 1, 'once')
  assert.equal(made.length, 1, 'one buffer')
  assert.equal(made[0].size, toonBufferWords(layout, 4, 0) * 4, 'three rows of room four')
  assert.deepEqual(
    [...writes[0].words],
    [TOON_ROWS_AT + 4 * layout.rowWords, layout.texels, layout.rowWords, 0],
    'the header: where the patterns start, the resolution, the words of a row',
  )
  assert.equal(rows()[0].words.length, 3 * layout.rowWords)
  const floats = new Float32Array(rows()[0].words.buffer)
  const indirect = (row: number) =>
    floats[row * layout.rowWords + layout.row.params + TOON_PARAM.diffuseIndirectScale]
  // The scale of the diffuse indirect light: the default profile's 1, then the two profiles'.
  assert.ok(Math.abs(indirect(0) - 1) < 1e-6)
  assert.ok(Math.abs(indirect(1) - 0.3) < 1e-6)
  assert.ok(Math.abs(indirect(2) - 0.4) < 1e-6)
  toonProfileRow({ diffuseIndirectScale: 0.5 })
  followToonProfiles(device, TOON_PROFILE_RESOLUTION, run)
  assert.equal(rows().length, 2, 'again')
  assert.equal(rows()[1].words.length, 4 * layout.rowWords)
  assert.equal(made.length, 1, 'the room of four holds them')
  assert.equal(toonTablesOf(device, TOON_PROFILE_RESOLUTION, run).rows, 4)
})

test('the extinction of each row is the profile’s per centimetre, the default profile’s for a row nobody holds', () => {
  const extinctions = toonShadowExtinctions()!
  assert.ok(Math.abs(extinctions[0] - 0.1) < 1e-6)
  assert.ok(Math.abs(extinctions[1] - 0.1) < 1e-6)
  assert.ok(Math.abs(extinctions[255] - 0.1) < 1e-6)
  const row = toonProfileRow({ shadowExtinctionCoefficient: 40 })
  assert.ok(Math.abs(toonShadowExtinctions()![row] - 0.4) < 1e-6)
  releaseToonProfile(row)
})

test('a profile whose image failed to load is lit plainly and reported once, with no work after it', () => {
  const failed = {
    isTexture: true,
    id: 'broken',
    version: 0,
    image: { complete: true, naturalWidth: 0, src: 'broken.png' },
  }
  const owner = { released: new Set<() => void>() }
  const row = holdToonProfile(owner, { shadowHatchingPatternTexture: failed as never }, true)
  const warnings: unknown[] = []
  const warn = console.warn
  console.warn = (...args: unknown[]) => warnings.push(args)
  try {
    const { device, rows, made } = recorder()
    followToonProfiles(device, TOON_PROFILE_RESOLUTION, run)
    followToonProfiles(device, TOON_PROFILE_RESOLUTION, run)
    assert.equal(rows().length, 1, 'rows written once, and not rebuilt each frame')
    assert.equal(made.length, 1)
    assert.equal(warnings.length, 1, 'reported once')
    const slot = new Uint32Array(rows()[0].words.buffer)[
      row * toonLayout(TOON_PROFILE_RESOLUTION).rowWords +
        toonLayout(TOON_PROFILE_RESOLUTION).row.params +
        TOON_PARAM.patternSlot
    ]
    assert.equal(slot, 0, 'no pattern slot: plain')
    // A picture set on the failed image later is seen: the profile is looked at again, its image baked.
    failed.image = { complete: true, naturalWidth: 8, src: 'fixed.png' }
    failed.version++
    // The next frame sees the new picture. The recorder has no encoder: the bake being reached is the throw.
    run.frame++
    assert.throws(
      () => followToonProfiles(device, TOON_PROFILE_RESOLUTION, run),
      /createCommandEncoder/,
      'the bake is tried at the new picture',
    )
  } finally {
    console.warn = warn
    holdToonProfile(owner, null, false)
  }
})

test('a profile whose image is absent is lit plainly with no per-frame work', () => {
  const absent = { isTexture: true, id: 'absent', version: 0, image: null }
  const owner = { released: new Set<() => void>() }
  holdToonProfile(owner, { shadowHatchingPatternTexture: absent as never }, true)
  try {
    const { device, rows } = recorder()
    followToonProfiles(device, TOON_PROFILE_RESOLUTION, run)
    followToonProfiles(device, TOON_PROFILE_RESOLUTION, run)
    assert.equal(rows().length, 1, 'rows written once')
  } finally {
    holdToonProfile(owner, null, false)
  }
})

test('a picture element given its source later is seen without a new version of its texture', () => {
  const element = { complete: true, naturalWidth: 0, src: '' }
  const waiting = { isTexture: true, id: 'later', version: 0, image: element }
  const owner = { released: new Set<() => void>() }
  holdToonProfile(owner, { shadowHatchingPatternTexture: waiting as never }, true)
  try {
    const { device, rows } = recorder()
    followToonProfiles(device, TOON_PROFILE_RESOLUTION, run)
    followToonProfiles(device, TOON_PROFILE_RESOLUTION, run)
    assert.equal(rows().length, 1, 'no source yet: nothing to wait for, no per-frame work')
    Object.assign(element, { src: 'later.png', naturalWidth: 8 })
    // The next frame sees the new source. The recorder has no encoder: the bake being reached is the throw.
    run.frame++
    assert.throws(
      () => followToonProfiles(device, TOON_PROFILE_RESOLUTION, run),
      /createCommandEncoder/,
    )
  } finally {
    holdToonProfile(owner, null, false)
  }
})

test('an image is a profile’s own by its name, and the profile that wears one takes a pattern slot', () => {
  assert.equal(toonProfileRow({ shadowHatchingPatternTexture: image('a') }), 4)
  assert.equal(
    toonProfileRow({ shadowHatchingPatternTexture: image('b') }),
    5,
    'an image by its name',
  )
  assert.equal(toonProfileRow({ shadowHatchingPatternTexture: image('a') }), 4)
})

test('more profiles wearing images than slots are refused when the material is declared', () => {
  // Two wear images already (above).
  for (let i = 0; i < TOON_PATTERN_SLOTS - 2; i++)
    toonProfileRow({ diffuseRampOffsetTexture: image(`slot${i}`) })
  assert.throws(() => toonProfileRow({ diffuseRampOffsetTexture: image('one more') }), RangeError)
  assert.equal(
    toonProfileRow({ diffuseIndirectScale: 0.6 }) > 0,
    true,
    'a profile with no image is no matter',
  )
})

test('a row a material gives back is free for the next profile, and the table shrinks past its last row', () => {
  const owner = { released: new Set<() => void>() }
  const before = registeredToonProfiles().profiles.length
  const row = holdToonProfile(owner, { diffuseIndirectScale: 0.91 }, true)
  assert.equal(row, before + 1)
  // The same profile held by a second record shares the row; it is free once both let it go.
  const other = { released: new Set<() => void>() }
  assert.equal(holdToonProfile(other, { diffuseIndirectScale: 0.91 }, true), row)
  for (const hook of owner.released) hook()
  assert.equal(registeredToonProfiles().profiles.length, before + 1, 'still held by the other')
  holdToonProfile(other, null, false)
  assert.equal(registeredToonProfiles().profiles.length, before, 'the table shrinks')
  assert.equal(toonProfileRow({ diffuseIndirectScale: 0.92 }), row, 'the row is taken again')
  releaseToonProfile(row)
})

test('re-holding the only toon record counts one change, not two', () => {
  const owner = { released: new Set<() => void>() }
  const users = registeredToonProfiles().users
  holdToonProfile(owner, { diffuseIndirectScale: 0.93 }, true)
  const at = registeredToonProfiles().revision
  const row = holdToonProfile(owner, { diffuseIndirectScale: 0.93 }, true)
  assert.equal(registeredToonProfiles().revision, at, 'the same profile again changes nothing')
  assert.equal(registeredToonProfiles().users, users + 1)
  holdToonProfile(owner, null, false)
  assert.ok(row > 0)
})

test('an image is classified by what its source is: absent, loading, decoded or failed', () => {
  const of = (picture: unknown) => imageState({ isTexture: true, id: 'x', image: picture } as never)
  assert.equal(of(null), 'absent')
  assert.equal(of({ complete: false, naturalWidth: 0 }), 'loading')
  assert.equal(of({ complete: true, naturalWidth: 4 }), 'decoded')
  assert.equal(of({ complete: true, naturalWidth: 0, src: 'a.png' }), 'failed')
  assert.equal(
    of({ complete: true, naturalWidth: 0, src: '', currentSrc: '' }),
    'absent',
    'no source yet',
  )
  assert.equal(of({ readyState: 1, videoWidth: 0 }), 'loading')
  assert.equal(of({ readyState: 4, videoWidth: 16 }), 'decoded')
  assert.equal(of({ width: 32, height: 32 }), 'decoded')
  assert.equal(of({ width: 0, height: 0 }), 'failed')
})

test('two resolutions of one device each keep their buffer, none replacing the other’s', () => {
  const { device, made } = recorder()
  const a = { frame: 0 },
    b = { frame: 0 }
  const low = toonTablesOf(device, TOON_PROFILE_RESOLUTION, a)
  const high = toonTablesOf(device, TOON_PROFILE_RESOLUTION + 8, b)
  assert.notEqual(low.buffer, high.buffer)
  assert.equal(toonTablesOf(device, TOON_PROFILE_RESOLUTION, a), low, 'the first is served again')
  assert.equal(toonTablesOf(device, TOON_PROFILE_RESOLUTION + 8, b), high)
  assert.equal(made.length, 2, 'nothing made again')
})

test('a buffer is kept while a runtime records its texels, however long no one asks it, and retired when none does', () => {
  const { device, made } = recorder()
  const a = { frame: 0 },
    b = { frame: 0 }
  const at = (r: object, delta = 0) => toonTablesOf(device, TOON_PROFILE_RESOLUTION + delta, r)
  at(a)
  const still = at(b, 8)
  // A renders alone for any time: the still runtime B keeps its buffer.
  for (let i = 0; i < 1000; i++) at(a)
  destroyAllRetired(device)
  assert.equal(made.filter((m) => m.destroyed).length, 0, 'nothing retired while B records it')
  assert.equal(at(b, 8), still, 'B is served its own buffer again')
  // B switches resolution: the one it left, recorded by no one, is retired.
  at(b)
  destroyAllRetired(device)
  assert.deepEqual(
    made.map((m) => m.destroyed),
    [false, true],
    'the old resolution is retired',
  )
})

test('a resolution another runtime still records is not retired when one runtime leaves it', () => {
  const { device, made } = recorder()
  const a = { frame: 0 },
    b = { frame: 0 }
  toonTablesOf(device, TOON_PROFILE_RESOLUTION + 8, a)
  toonTablesOf(device, TOON_PROFILE_RESOLUTION + 8, b)
  toonTablesOf(device, TOON_PROFILE_RESOLUTION, a)
  destroyAllRetired(device)
  assert.equal(made.filter((m) => m.destroyed).length, 0, 'B still records it')
})

test('a disposed runtime releases its record: the buffer none records is retired, a shared one stays', () => {
  const { device, made } = recorder()
  const a = { frame: 0 },
    b = { frame: 0 },
    c = { frame: 0 }
  toonTablesOf(device, TOON_PROFILE_RESOLUTION, a)
  toonTablesOf(device, TOON_PROFILE_RESOLUTION, b)
  toonTablesOf(device, TOON_PROFILE_RESOLUTION + 8, c)
  releaseToonTables(a)
  destroyAllRetired(device)
  assert.equal(made.filter((m) => m.destroyed).length, 0, 'B shares the buffer of A')
  releaseToonTables(b)
  releaseToonTables(c)
  destroyAllRetired(device)
  assert.equal(made.filter((m) => m.destroyed).length, 2, 'no runtime records either: both retired')
})

test('a buffer grown while two runtimes share its resolution is destroyed with the last of them', () => {
  const { device, made } = recorder()
  const a = { frame: 0 },
    b = { frame: 0 }
  const at = (r: object) => toonTablesOf(device, TOON_PROFILE_RESOLUTION + 16, r)
  const small = at(a)
  at(b)
  // Enough new profiles to outgrow the room the buffer was made with.
  const holds = Array.from({ length: small.rows + 1 }, (_, i) => {
    const record = { released: new Set<() => void>() }
    holdToonProfile(record, { diffuseIndirectScale: 0.5 + i / 1000 }, true)
    return record
  })
  try {
    const grown = at(a)
    assert.notEqual(grown, small, 'a larger buffer')
    assert.equal(made.length, 2)
    releaseToonTables(a)
    destroyAllRetired(device)
    assert.deepEqual(
      made.map((m) => m.destroyed),
      [true, false],
      'the grown one stays: B uses it',
    )
    releaseToonTables(b)
    destroyAllRetired(device)
    assert.equal(made[1].destroyed, true, 'the grown one goes with the last runtime')
  } finally {
    for (const record of holds) holdToonProfile(record, null, false)
  }
})

test('a lost runtime or a replaced device destroys the buffer at once, without waiting for a submit', () => {
  const lostDevice = recorder()
  const gone = { frame: 0, lost: true }
  toonTablesOf(lostDevice.device, TOON_PROFILE_RESOLUTION, gone)
  releaseToonTables(gone)
  assert.equal(lostDevice.made[0].destroyed, true, 'lost: destroyed at once')
  const first = recorder(),
    second = recorder()
  const moved = { frame: 0 }
  toonTablesOf(first.device, TOON_PROFILE_RESOLUTION, moved)
  toonTablesOf(second.device, TOON_PROFILE_RESOLUTION, moved)
  assert.equal(first.made[0].destroyed, true, 'the old device’s buffer goes at once')
  assert.equal(second.made[0].destroyed, false)
  releaseToonTables(moved)
  destroyAllRetired(second.device)
  assert.equal(second.made[0].destroyed, true, 'a live device retires it with the frame')
})

test('every render of a host-driven runtime follows once, and two runtimes of one device each follow their own images', () => {
  const { device } = recorder()
  const tables = toonTablesOf(device, TOON_PROFILE_RESOLUTION, run)
  const host = { frame: 40 },
    other = { frame: 40 }
  const stamp = (r: object) => tables.followed.get(r)?.image
  followToonProfiles(device, TOON_PROFILE_RESOLUTION, host)
  assert.equal(stamp(host), 40, 'followed at the runtime’s image')
  assert.equal(stamp(other), undefined, 'the other runtime’s stamp is its own')
  followToonProfiles(device, TOON_PROFILE_RESOLUTION, other)
  assert.equal(stamp(other), 40, 'the same image number of another runtime follows too')
  host.frame++
  followToonProfiles(device, TOON_PROFILE_RESOLUTION, host)
  assert.equal(stamp(host), 41, 'a host render with no scheduler follows again')
  assert.equal(stamp(other), 40, 'and moves nothing of the other')
})

test('the lights following the buffer several times in a frame write it once', () => {
  const { device, writes } = recorder()
  const before = registeredToonProfiles().revision
  const record = { released: new Set<() => void>() }
  holdToonProfile(record, { diffuseIndirectScale: 0.9 }, true)
  try {
    followToonProfiles(device, TOON_PROFILE_RESOLUTION, run)
    const once = writes.length
    followToonProfiles(device, TOON_PROFILE_RESOLUTION, run)
    followToonProfiles(device, TOON_PROFILE_RESOLUTION, run)
    assert.equal(writes.length, once, 'the later asks of the frame write nothing')
    run.frame++
    followToonProfiles(device, TOON_PROFILE_RESOLUTION, run)
    assert.ok(registeredToonProfiles().revision > before)
  } finally {
    for (const hook of record.released) hook()
  }
})
