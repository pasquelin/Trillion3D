import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts'
import { wordsOf } from '../../gpu/core/wordViews.ts'
import type { Object3D } from '../../../../sdk-core/src/world/object/object3d.ts'
import type { WaterExclusionVolume } from '../../../../sdk-core/src/world/object/waterExclusionVolume.ts'
import { oncePerDevice } from '../../gpu/core/oncePerDevice.ts'
import { WATER_GROUP } from './waterLayout.ts'

/**
 * THE WATER'S EXCLUSION VOLUMES, as the water's fragments read them: where a volume of the world (`WaterExclusionVolume`) excludes a
 * body, the body's surface is not drawn inside the box. The table is a storage buffer of words in the water's group, present only in
 * the variant of the water programs compiled for a world that holds a volume (the default programs hold none of it):
 * - a head of `HEAD` words: the count of volumes, then where the body ranks begin;
 * - one record of `VOLUME_WORDS` words a volume: the three rows of the matrix that takes a world point into the box's unit cube (four
 *   floats each, the translation last), the volume's `mode` (0 `allExceptListed`, 1 `onlyListed`), then the first of its body ranks
 *   and how many;
 * - the body ranks, each volume's run after the previous one's.
 * Nothing caps it: the table holds every volume and rank the world has, and grows (`WaterExclusionTable.words`) to what it holds.
 * A body is the rank of an item of the water pass (its place in the blend's items: the vertex stage knows it, `waterBodyLane.ts`);
 * a volume lists the ranks of every item of the meshes it names (`bodies`). A fragment is cut when its world point lies in the box
 * (faces included) and `excludes` says so: the rank listed for `onlyListed`, not listed for `allExceptListed`.
 */
export const WATER_EXCLUSION_BINDING = 10

/** The layout of a group that holds the table alone (`waterTableGroup`): the passes before the water that draw its surface cut it too
 *  (`frontStage.ts`), at the water group's place. */
export const waterTableLayout = oncePerDevice((device: GPUDevice) =>
  device.createBindGroupLayout({
    label: 'Trillion3D water exclusion volumes',
    entries: [
      {
        binding: WATER_EXCLUSION_BINDING,
        visibility: GPUShaderStage.FRAGMENT,
        buffer: { type: 'read-only-storage' },
      },
    ],
  }),
)

const HEAD = 4,
  VOLUME_WORDS = 16

/** The modes as the table carries them. */
const MODE = { allExceptListed: 0, onlyListed: 1 } as const

/** The table's declaration and the test `waterExcluded(P, body)`: whether the world point `P` of the item of rank `body` lies in a
 *  volume that excludes it. */
export const WATER_EXCLUSION_WGSL = wgslBlock(
  'WATER_EXCLUSION_WGSL',
  [],
  `@group(${WATER_GROUP}) @binding(${WATER_EXCLUSION_BINDING}) var<storage,read> waterExclusions:array<u32>;
fn waterExclusionRow(at:u32,p:vec4f)->f32{
 return dot(vec4f(bitcast<f32>(waterExclusions[at]),bitcast<f32>(waterExclusions[at+1u]),bitcast<f32>(waterExclusions[at+2u]),bitcast<f32>(waterExclusions[at+3u])),p);
}
fn waterExcluded(P:vec3f,body:u32)->bool{
 let count=waterExclusions[0];
 let bodiesAt=waterExclusions[1];
 let p=vec4f(P,1.0);
 for(var v=0u;v<count;v++){
  let at=${HEAD}u+v*${VOLUME_WORDS}u;
  let local=vec3f(waterExclusionRow(at,p),waterExclusionRow(at+4u,p),waterExclusionRow(at+8u,p));
  if(any(abs(local)>vec3f(0.5))){continue;}
  var listed=false;
  let first=bodiesAt+waterExclusions[at+13u];
  let last=first+waterExclusions[at+14u];
  for(var k=first;k<last;k++){
   if(waterExclusions[k]==body){listed=true;break;}
  }
  if(listed==(waterExclusions[at+12u]==${MODE.onlyListed}u)){return true;}
 }
 return false;
}
`,
)

/** The words the table starts with: it grows from there to what the world holds. */
const FIRST_WORDS = HEAD + 4 * VOLUME_WORDS

/** The table: its words (those up to `length` are the table), sent to the GPU by `writeChanged` when `pack` has rewritten them. */
export class WaterExclusionTable {
  private floats = new Float32Array(FIRST_WORDS)
  words: Uint32Array<ArrayBuffer> = wordsOf(this.floats)
  /** The words of `words` the table fills. */
  length = HEAD
  /** How many times `pack` rewrote the words: what a pass that draws from the volumes keeps to know they moved. */
  revision = 0
  private readonly inverse = new Matrix4()
  /** The volumes kept (a flat box is not), their inverses (twelve numbers each: the three rows) and the rank lists of their bodies. */
  private readonly kept: WaterExclusionVolume[] = []
  private inverses = new Float64Array(12 * 4)
  private readonly runs: (readonly number[])[] = []
  /** What the words were packed from, for every volume asked: its world matrix, its mode, its bodies; and the ranks' epoch. */
  private readonly seen: WaterExclusionVolume[] = []
  private poses = new Float64Array(16 * 4)
  private readonly modes: number[] = []
  private readonly listed: Object3D[][] = []
  private epoch: object | undefined

  /** Whether `volumes` are those the words were packed from, with the same poses, modes and bodies, over the same ranks. */
  private unchanged(volumes: ReadonlySet<WaterExclusionVolume>, epoch: object) {
    const { seen, poses, modes, listed } = this
    if (epoch !== this.epoch || volumes.size !== seen.length) return false
    let v = 0
    for (const volume of volumes) {
      volume.updateWorldMatrix(true, false)
      if (volume !== seen[v] || MODE[volume.mode] !== modes[v]) return false
      const e = volume.matrixWorld.elements,
        bodies = volume.bodies,
        was = listed[v]
      for (let i = 0; i < 16; i++) if (e[i] !== poses[v * 16 + i]) return false
      if (bodies.length !== was.length) return false
      for (let k = 0; k < was.length; k++) if (bodies[k] !== was[k]) return false
      v++
    }
    return true
  }

  /** Notes what the volume at rank `v` is packed from. */
  private note(v: number, volume: WaterExclusionVolume) {
    this.seen[v] = volume
    this.poses.set(volume.matrixWorld.elements, v * 16)
    this.modes[v] = MODE[volume.mode]
    this.listed[v] = volume.bodies.slice()
  }

  /**
   * Fills `words` from `volumes`: each one's inverse world matrix, mode and the ranks `ranksOf` gives for the meshes in its `bodies` (asked
   * once a body). A volume whose box is flat (a scale of zero) holds nothing and is left out. The words are rewritten only when a volume
   * moved, changed its mode or its bodies, or `epoch` (what the ranks were taken from) is another: the rest of an image allocates nothing
   * once the table has grown to its size. Returns whether it rewrote them.
   */
  pack(
    volumes: ReadonlySet<WaterExclusionVolume>,
    ranksOf: (body: Object3D) => readonly number[],
    epoch: object,
  ) {
    if (this.unchanged(volumes, epoch)) return false
    const { kept, inverse, runs } = this
    kept.length = runs.length = this.seen.length = 0
    if (volumes.size * 16 > this.poses.length) this.poses = new Float64Array(volumes.size * 32)
    let ranks = 0,
      seen = 0
    for (const volume of volumes) {
      volume.updateWorldMatrix(true, false)
      this.note(seen++, volume)
      inverse.copy(volume.matrixWorld)
      // A flat box has no inverse (it would be the zero matrix, which holds every point).
      if (inverse.determinant() === 0) continue
      inverse.invert()
      const v = kept.length
      if (12 * (v + 1) > this.inverses.length) {
        const grown = new Float64Array(this.inverses.length * 2)
        grown.set(this.inverses)
        this.inverses = grown
      }
      const e = inverse.elements
      for (let row = 0; row < 3; row++)
        for (let column = 0; column < 4; column++)
          this.inverses[v * 12 + row * 4 + column] = e[column * 4 + row]
      kept.push(volume)
      for (const body of volume.bodies) {
        const list = ranksOf(body)
        runs.push(list)
        ranks += list.length
      }
    }
    const bodiesAt = HEAD + kept.length * VOLUME_WORDS,
      length = bodiesAt + ranks
    if (length > this.words.length) {
      this.floats = new Float32Array(Math.max(length, this.words.length * 2))
      this.words = wordsOf(this.floats)
    }
    const { words, floats } = this
    words.fill(0, 0, length)
    this.length = length
    words[0] = kept.length
    words[1] = bodiesAt
    let bodies = 0,
      run = 0
    for (let v = 0; v < kept.length; v++) {
      const volume = kept[v],
        at = HEAD + v * VOLUME_WORDS
      for (let i = 0; i < 12; i++) floats[at + i] = this.inverses[v * 12 + i]
      words[at + 12] = MODE[volume.mode]
      words[at + 13] = bodies
      for (let k = 0; k < volume.bodies.length; k++)
        for (const rank of runs[run++]) words[bodiesAt + bodies++] = rank
      words[at + 14] = bodies - words[at + 13]
    }
    this.epoch = epoch
    this.revision++
    return true
  }
}
