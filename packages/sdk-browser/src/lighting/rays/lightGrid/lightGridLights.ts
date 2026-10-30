import { saturate } from '../../../../../math/src/scalar/reals.ts'
import {
  LIGHT_KIND,
  LIGHT_KIND_SPAN,
  LIGHT_PAYLOAD_MASK,
} from '../../../../../sdk-core/src/scene/light/contracts.ts'
import { LIGHT_FIELD, baseOf } from '../../../../../sdk-core/src/scene/light/fields.ts'

/** Words of a local light's record in the grid builder (`lightGridWgsl.ts`): its place and reach, its axis and the cosine of its cone, then its kind and rank. */
export const LIGHT_GRID_RECORD_WORDS = 12

/** The bits of a record's last group: the rank of the light below `LIGHT_GRID_KIND_SHIFT`, its kind above. */
export const LIGHT_GRID_KIND_SHIFT = 30

/** The lights of an image as the grid reads them: the records of the local lights, the ranks of the suns and the box that holds the reach of the local lights. */
export interface LightGridLights {
  records: Float32Array<ArrayBuffer>
  /** The same words, whole. */
  words: Uint32Array<ArrayBuffer>
  /** The local lights recorded. */
  finite: number
  /** The ranks of the suns, `suns` of them. */
  sunRanks: Uint32Array<ArrayBuffer>
  suns: number
  boundMin: [number, number, number]
  boundMax: [number, number, number]
  /** The lights the store held (the ranks are below it). */
  lights: number
  /** The store's table as words, kept while the table stays in the same memory. */
  bits: Uint32Array
}

/** What the grid reads of the light store: its packed table and how many lights it holds. */
export interface LightGridTable {
  readonly packed: Float32Array
  readonly count: number
}

export const createLightGridLights = (): LightGridLights => {
  const buffer = new ArrayBuffer(16 * LIGHT_GRID_RECORD_WORDS * 4)
  return {
    records: new Float32Array(buffer),
    words: new Uint32Array(buffer),
    finite: 0,
    sunRanks: new Uint32Array(16),
    suns: 0,
    boundMin: [Infinity, Infinity, Infinity],
    boundMax: [-Infinity, -Infinity, -Infinity],
    lights: 0,
    bits: new Uint32Array(0),
  }
}

/** The sign of `sign` taken by `magnitude`, a negative zero included. */
const copySign = (magnitude: number, sign: number) =>
  sign < 0 || Object.is(sign, -0) ? -magnitude : magnitude

/** The box of a point light: its sphere. */
export function pointLightBounds(c: ArrayLike<number>, radius: number, lo: number[], hi: number[]) {
  for (let a = 0; a < 3; a++) {
    lo[a] = c[a]! - radius
    hi[a] = c[a]! + radius
  }
}

/** The box of a spot light of unit axis `n` and cosine `cosOuter`: the ray from its place to the tip of the cone, the disc round the farthest part of the cone, and the points of the coordinate axes that lie inside the cone. */
export function spotLightBounds(
  c: ArrayLike<number>,
  n: ArrayLike<number>,
  radius: number,
  cosOuter: number,
  lo: number[],
  hi: number[],
) {
  const sin = Math.sqrt(1 - cosOuter * cosOuter)
  for (let a = 0; a < 3; a++) {
    const tip = c[a]! + n[a]! * radius
    const disc = Math.sqrt(saturate(1 - n[a]! * n[a]!))
    const axis = Math.abs(n[a]!) > cosOuter ? c[a]! + copySign(radius, n[a]!) : c[a]!
    lo[a] = Math.min(c[a]!, tip, c[a]! + radius * (n[a]! * cosOuter - disc * sin), axis)
    hi[a] = Math.max(c[a]!, tip, c[a]! + radius * (n[a]! * cosOuter + disc * sin), axis)
  }
}

/** The box of a rectangle light of unit normal `n`: the disc of its reach round it and the farthest corner of the box of that size in the direction of the normal. */
export function rectLightBounds(
  c: ArrayLike<number>,
  n: ArrayLike<number>,
  radius: number,
  lo: number[],
  hi: number[],
) {
  for (let a = 0; a < 3; a++) {
    const corner = copySign(radius, n[a]!)
    const disc = Math.sqrt(saturate(1 - n[a]! * n[a]!))
    lo[a] = Math.min(c[a]! + corner, c[a]! - radius * disc)
    hi[a] = Math.max(c[a]! + corner, c[a]! + radius * disc)
  }
}

const lo = [0, 0, 0]
const hi = [0, 0, 0]
const place = [0, 0, 0]
const axis = [0, 0, 0]

/** The kinds of the local lights in the order their records are kept: by type, as the reference sorts its lights (points, spots, rectangles). */
const LOCAL_KINDS = [LIGHT_KIND.point, LIGHT_KIND.spot, LIGHT_KIND.rect] as const
/** Where the records of each kind begin, filled by `gatherLightGridLights` (indexed by kind). */
const starts = [0, 0, 0, 0]

/** `held` grown to hold `words` words, its words kept. */
function grown<T extends Float32Array | Uint32Array>(held: T, words: number): T {
  if (held.length >= words) return held
  const next = new (held.constructor as new (n: number) => T)(Math.max(words, held.length * 2))
  next.set(held)
  return next
}

/** The kind of the light whose record begins at word `base` of the table. */
const kindAt = (bits: Uint32Array, base: number) =>
  (bits[base + LIGHT_FIELD.kind]! & LIGHT_PAYLOAD_MASK) % LIGHT_KIND_SPAN

/**
 * THE LIGHTS OF AN IMAGE FOR THE GRID, written over `into` in place from the store's table: a sun (a directional light) is a light at infinity, whose rank is kept;
 * a point, a spot or a rectangle with a reach is a local light, whose record (place, reach, axis, cosine of the cone, kind and rank) is kept and whose box is joined to the grid's.
 * The records are sorted by type (points, spots, rectangles) and by slot within a type, so that a cell lists its lights in that order. Every light of the table is in the grid, whether or not the view draws it:
 * what a hit is lit by does not depend on the distance of the eye. The rank of a light is its slot, which is its place in the lights' buffer.
 */
export function gatherLightGridLights(table: LightGridTable, into: LightGridLights) {
  const p = table.packed
  if (
    into.bits.buffer !== p.buffer ||
    into.bits.byteOffset !== p.byteOffset ||
    into.bits.length !== p.length
  )
    into.bits = new Uint32Array(p.buffer, p.byteOffset, p.length)
  into.suns = 0
  into.finite = 0
  into.lights = table.count
  into.boundMin.fill(Infinity)
  into.boundMax.fill(-Infinity)
  starts.fill(0)
  for (let slot = 0; slot < table.count; slot++) {
    const base = baseOf(slot)
    const kind = kindAt(into.bits, base)
    if (kind === LIGHT_KIND.directional) {
      into.sunRanks = grown(into.sunRanks, into.suns + 1)
      into.sunRanks[into.suns++] = slot
    } else if (p[base + LIGHT_FIELD.range]! > 0) starts[kind]!++
  }
  let finite = 0
  for (const kind of LOCAL_KINDS) {
    const count = starts[kind]!
    starts[kind] = finite
    finite += count
  }
  into.finite = finite
  const records = grown(into.records, finite * LIGHT_GRID_RECORD_WORDS)
  if (records !== into.records) {
    into.records = records
    into.words = new Uint32Array(records.buffer)
  }
  for (let slot = 0; slot < table.count; slot++) {
    const base = baseOf(slot)
    const kind = kindAt(into.bits, base)
    const radius = p[base + LIGHT_FIELD.range]!
    if (kind === LIGHT_KIND.directional || !(radius > 0)) continue
    const at = starts[kind]!++ * LIGHT_GRID_RECORD_WORDS
    const cosOuter = kind === LIGHT_KIND.spot ? p[base + LIGHT_FIELD.cosCone]! : 0
    for (let a = 0; a < 3; a++) {
      place[a] = p[base + LIGHT_FIELD.position + a]!
      axis[a] = p[base + LIGHT_FIELD.direction + a]!
      into.records[at + a] = place[a]!
      into.records[at + 4 + a] = axis[a]!
    }
    into.records[at + 3] = radius
    into.records[at + 7] = cosOuter
    into.words[at + 8] = (slot | (kind << LIGHT_GRID_KIND_SHIFT)) >>> 0
    if (kind === LIGHT_KIND.point) pointLightBounds(place, radius, lo, hi)
    else if (kind === LIGHT_KIND.spot) spotLightBounds(place, axis, radius, cosOuter, lo, hi)
    else rectLightBounds(place, axis, radius, lo, hi)
    for (let a = 0; a < 3; a++) {
      into.boundMin[a] = Math.min(into.boundMin[a]!, lo[a]!)
      into.boundMax[a] = Math.max(into.boundMax[a]!, hi[a]!)
    }
  }
}
