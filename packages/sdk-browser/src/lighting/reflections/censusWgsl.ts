import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { REFLECTION_SIDE } from './constants.ts'

/**
 * THE CENSUS OF THE REFLECTIONS' RAYS, the one buffer of counters an image's trace fills and
 * `census.ts` reads back a few images late: cleared before the image's trace, so the words are the
 * counts of that image alone, both surfaces together.
 *
 * The screen stage counts every ray it casts (`rays`: a grid texel whose picked pixel traces) and
 * where it ended: past the near field (`far`, the field answers all the screen left there), answered
 * in part or whole by the screen (`screen`: the march met a surface it trusts), answered whole with
 * nothing left (`whole`), or left to the scene stage (`left`). The scene stage counts each ray it
 * takes once, by how its walk of the proxy ended (`fates`, `REFLECTION_FATES`): no proxy at all, the
 * four ways a walk is spent (its units, its triangle tests, its tree steps, a mesh's walk — the
 * causes a probe's ray reports), a surface hit, the ray leaving the scene to the environment, a miss
 * that went nowhere (the field answers it), or no walk at all because the screen's surface was
 * closer than the proxy can tell; and, for the rays that walked, the units the walk spent
 * (`work`: under 8, 16, 32, 64, 128, 256, 512, more).
 *
 * A workgroup counts in its own memory and adds its words to the buffer once: a ray costs a
 * workgroup atomic, a workgroup at most `REFLECTION_CENSUS_WORDS` global ones.
 */
export const REFLECTION_FATES = [
  'noProxy',
  'work',
  'tests',
  'tree',
  'mesh',
  'hit',
  'open',
  'miss',
  'bound',
] as const
export type ReflectionFate = (typeof REFLECTION_FATES)[number]
/** Buckets of the walk's units: under 8, doubling, the last open. */
export const REFLECTION_WORK_BUCKETS = 8
export const REFLECTION_CENSUS = {
  rays: 0,
  far: 1,
  screen: 2,
  whole: 3,
  left: 4,
  fates: 5,
  work: 5 + REFLECTION_FATES.length,
} as const
export const REFLECTION_CENSUS_WORDS = REFLECTION_CENSUS.work + REFLECTION_WORK_BUCKETS

// The flush gives each word to one lane of the workgroup.
if (REFLECTION_CENSUS_WORDS > REFLECTION_SIDE * REFLECTION_SIDE)
  throw new RangeError(`the census holds more words than a workgroup has lanes`)

/** The index of a fate in `REFLECTION_FATES`. */
const fate = (name: ReflectionFate) => REFLECTION_FATES.indexOf(name)

/**
 * How the last proxy ray ended and the units it spent, for the scene stage to count
 * (`reflectionProxied` sets them): `reflectionFate` is a number of `REFLECTION_FATES`, a spent walk's
 * its cause (`RT_CAUSE_*`, one to four).
 */
export const REFLECTION_FATE_WGSL = wgslBlock(
  'REFLECTION_FATE_WGSL',
  [],
  `${wgslConsts({
    REFLECTION_FATE_NO_PROXY: fate('noProxy'),
    REFLECTION_FATE_HIT: fate('hit'),
    REFLECTION_FATE_OPEN: fate('open'),
    REFLECTION_FATE_MISS: fate('miss'),
    REFLECTION_FATE_BOUND: fate('bound'),
  })}
var<private> reflectionFate:u32;
var<private> reflectionWork:u32;`,
)

/**
 * The counters in a shader, their buffer at binding `binding` of group 0: `censusAdd` counts one
 * ray in a word of the workgroup's own, `censusWorkBucket` is the bucket of a walk's units, and
 * `censusFlush`, after a workgroup barrier, adds the workgroup's words to the buffer, a lane a word.
 */
export const reflectionCensusWgsl = (binding: number) =>
  wgslBlock(
    `reflectionCensusWgsl(${binding})`,
    [REFLECTION_FATE_WGSL],
    `${wgslConsts({
      REFLECTION_CENSUS_WORDS,
      REFLECTION_CENSUS_RAYS: REFLECTION_CENSUS.rays,
      REFLECTION_CENSUS_FAR: REFLECTION_CENSUS.far,
      REFLECTION_CENSUS_SCREEN: REFLECTION_CENSUS.screen,
      REFLECTION_CENSUS_WHOLE: REFLECTION_CENSUS.whole,
      REFLECTION_CENSUS_LEFT: REFLECTION_CENSUS.left,
      REFLECTION_CENSUS_FATES: REFLECTION_CENSUS.fates,
      REFLECTION_CENSUS_WORK: REFLECTION_CENSUS.work,
      REFLECTION_WORK_BUCKETS,
    })}
@group(0) @binding(${binding}) var<storage,read_write> reflectionCensus:array<atomic<u32>,${REFLECTION_CENSUS_WORDS}>;
var<workgroup> censusLocal:array<atomic<u32>,${REFLECTION_CENSUS_WORDS}>;
fn censusAdd(word:u32){atomicAdd(&censusLocal[word],1u);}
fn censusWorkBucket(units:u32)->u32{
 let eighths=units>>3u;
 return min(select(0u,firstLeadingBit(eighths)+1u,eighths>0u),REFLECTION_WORK_BUCKETS-1u);
}
fn censusFlush(lane:u32){
 if(lane<REFLECTION_CENSUS_WORDS){
  let n=atomicLoad(&censusLocal[lane]);
  if(n!=0u){atomicAdd(&reflectionCensus[lane],n);}
 }
}`,
  )
