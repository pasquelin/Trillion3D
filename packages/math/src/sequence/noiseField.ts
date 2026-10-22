import {
  axisWeights,
  volumeAddress,
  type AxisWeights,
  type NoiseVolume,
  type VolumeAddress,
} from './noiseEnergy.ts'

/**
 * THE ENERGY FIELD OF A MASK in the making, and what finds in it the pixel the void-and-cluster method asks for next: the tightest
 * cluster (the pixel that is on with the most energy) and the largest void (the one that is off with the least).
 *
 * Every pixel that is on gives its energy to its neighbours (`splat`): the field holds, for each pixel, the energy the pixels that
 * are on give it. The extremum is found over the field's `chunk` pixels at a time along a row — each chunk's best, then a
 * tournament over the chunks — so that a flip, which changes the energy of a few dozen chunks, costs a few thousand steps
 * instead of a scan of every pixel. The answer is the one the scan of the whole field in index order gives: where
 * two pixels tie, the first is the one.
 */
export interface EnergyField {
  address: VolumeAddress
  /** The energy each pixel receives (32 bits, as a mask's energy has always been summed). */
  energy: Float32Array
  /** Whether each pixel is on. */
  on: Uint8Array
  /** How many are on. */
  onCount: number
  /** Pixels a chunk spans along a row, as a shift. */
  chunkShift: number
  /** The chunks whose pixels changed since the extremums were last refreshed. */
  touched: { list: Int32Array; count: number; stamp: Int32Array; epoch: number }
  /** The plane's two axes and the time axis. */
  x: AxisWeights
  y: AxisWeights
  z: AxisWeights
}

/** A field over `volume`, every pixel off and empty, its axes weighted at `sigma`. */
export function createField(volume: NoiseVolume, sigma: number): EnergyField {
  const address = volumeAddress(volume)
  const chunkShift = Math.min(5, address.yShift)
  const chunks = address.count >> chunkShift
  return {
    address,
    energy: new Float32Array(address.count),
    on: new Uint8Array(address.count),
    onCount: 0,
    chunkShift,
    touched: { list: new Int32Array(chunks), count: 0, stamp: new Int32Array(chunks), epoch: 1 },
    x: axisWeights(volume.width, sigma, false),
    y: axisWeights(volume.height, sigma, false),
    z: axisWeights(volume.depth, sigma, false),
  }
}

/** Notes that the chunk of `pixel` changed. */
function touch({ touched, chunkShift }: EnergyField, pixel: number) {
  const chunk = pixel >> chunkShift
  if (touched.stamp[chunk] === touched.epoch) return
  touched.stamp[chunk] = touched.epoch
  touched.list[touched.count++] = chunk
}

/**
 * The pixel `index` gives its energy to its neighbours (`sign` 1), or takes it back (−1): along the image the product of the two
 * plane axes' weights at each offset, along the frames the time axis's, the pixel's own place apart.
 */
export function splat(field: EnergyField, index: number, sign: 1 | -1) {
  const { address: a, energy, x: ax, y: ay, z: az } = field
  const x = index & a.xMask,
    y = (index >> a.yShift) & a.yMask,
    z = index >> a.zShift
  for (let dy = ay.from; dy <= ay.to; dy++) {
    const wy = ay.weights[Math.abs(dy)] * sign
    const row = (z << a.zShift) + (((y + dy) & a.yMask) << a.yShift)
    for (let dx = ax.from; dx <= ax.to; dx++) {
      if (dx === 0 && dy === 0) continue
      const pixel = row + ((x + dx) & a.xMask)
      energy[pixel] += wy * ax.weights[Math.abs(dx)]
      touch(field, pixel)
    }
  }
  for (let dz = az.from; dz <= az.to; dz++) {
    if (dz === 0) continue
    const pixel = (((z + dz) & a.zMask) << a.zShift) + (index & ((1 << a.zShift) - 1))
    energy[pixel] += az.weights[Math.abs(dz)] * sign
    touch(field, pixel)
  }
}

/** Turns `pixel` on or off, its energy given or taken back; its chunk is one that changed. */
export function flip(field: EnergyField, pixel: number, on: boolean) {
  field.on[pixel] = on ? 1 : 0
  field.onCount += on ? 1 : -1
  splat(field, pixel, on ? 1 : -1)
  touch(field, pixel)
}

/** Which pixel an extremum looks for: the tightest cluster, or the largest void. */
export type Extremum = 'cluster' | 'void'

/** The chunks' best pixels and the tournament over them, for one kind of extremum. */
export interface ExtremumTree {
  kind: Extremum
  leaves: number
  /** The best energy of each node, and the pixel that has it, −1 for none. */
  value: Float64Array
  at: Int32Array
}

/** The best of the chunk `chunk`'s pixels, written to its leaf. */
function scanChunk(field: EnergyField, tree: ExtremumTree, chunk: number) {
  const { energy, on, chunkShift } = field
  const wantOn = tree.kind === 'cluster'
  const sign = wantOn ? 1 : -1
  let best = -Infinity,
    pick = -1
  for (let pixel = chunk << chunkShift, end = pixel + (1 << chunkShift); pixel < end; pixel++) {
    if ((on[pixel] === 1) !== wantOn) continue
    const value = sign * energy[pixel]
    if (value > best) {
      best = value
      pick = pixel
    }
  }
  tree.value[tree.leaves + chunk] = best
  tree.at[tree.leaves + chunk] = pick
}

/** Node `node` takes the better of its two children, the left one where they tie. */
function settle(tree: ExtremumTree, node: number) {
  const left = node * 2,
    right = left + 1
  const takeRight = tree.value[right] > tree.value[left]
  tree.value[node] = tree.value[takeRight ? right : left]
  tree.at[node] = tree.at[takeRight ? right : left]
}

/** A tournament over every chunk of `field`, built for `kind`. */
export function buildTree(field: EnergyField, kind: Extremum): ExtremumTree {
  const leaves = field.address.count >> field.chunkShift
  const tree = {
    kind,
    leaves,
    value: new Float64Array(leaves * 2),
    at: new Int32Array(leaves * 2),
  }
  for (let chunk = 0; chunk < leaves; chunk++) scanChunk(field, tree, chunk)
  for (let node = leaves - 1; node >= 1; node--) settle(tree, node)
  return tree
}

/** The extremum's pixel: the one a scan of the field in index order finds first, −1 where none qualifies. */
export const extremum = (tree: ExtremumTree) => tree.at[1]

/**
 * The trees brought up to date with what changed since: every touched chunk scanned again and its path to the root settled.
 * The touched set is then empty.
 */
export function refresh(field: EnergyField, trees: readonly ExtremumTree[]) {
  const { touched } = field
  for (const tree of trees) {
    for (let k = 0; k < touched.count; k++) {
      const chunk = touched.list[k]
      scanChunk(field, tree, chunk)
      for (let node = (tree.leaves + chunk) >> 1; node >= 1; node >>= 1) settle(tree, node)
    }
  }
  touched.count = 0
  touched.epoch++
}
