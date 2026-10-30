import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { workgroupTallyWgsl } from '../../gpu/core/workgroupTallyWgsl.ts'
import { REFLECTION_SIDE } from './constants.ts'

/**
 * THE CENSUS OF THE REFLECTIONS' RAYS, the one buffer of counters an image's trace fills and
 * `census.ts` reads back a few images late: cleared before the image's trace, so the words are the
 * counts of that image alone, both surfaces together.
 *
 * The screen stage counts the rays it casts (a grid texel whose picked pixel traces) by where they
 * ended: a hit, which answers them whole (`screen`: the march met a surface it trusts), or a miss left to the scene
 * stage (`left`), which add up to the rays cast.
 *
 * The scene stage counts each ray it takes once, by how its march through the global distance field ended
 * (`fates`, `REFLECTION_FATES`, `sceneTrace.ts`): no field to march (`noField`), a surface hit (the cache gave its
 * light; black where no card lights the surface), the ray leaving the scene to the environment, the screen's far trace answering it (`distant`, `wgsl.ts`), or no march
 * at all because the screen followed the ray to the longest ray; and, for the rays that marched, the steps the march took (`work`: under 8, 16, 32, 64, 128, 256,
 * 512, 1 024, 2 048, 4 096, 8 192, more), their sum (`workSum`) and the longest march (`workMax`, a workgroup's maximum poured by one atomic max).
 *
 * A workgroup counts in its own memory and adds its words to the buffer once (`workgroupTallyWgsl`).
 */
export const REFLECTION_FATES = ['noField', 'hit', 'open', 'bound', 'distant'] as const
export type ReflectionFate = (typeof REFLECTION_FATES)[number]
/**
 * Why a ray the screen stage cast ended as it did, each counted once, the words adding up to the rays cast (`screen` + `left`): the screen not traced for it
 * (`noTrace`: the whole trace is off this image; `noOrigin`: its origin lies off the image; `screensOff`: the settings turn the screen's traces off); a march that
 * met nothing (`exhausted`: it spent its iterations; `leftScreen`: it ran to the end of its span, the screen's edge or the longest ray, or never walked; `behind`: the rest,
 * the ray proved behind a surface by more than its thickness, and, where the minimum occupancy is above zero, the ray its lanes gave up); a hit the screen did not
 * trust (`rejPlane`: the plane's depth not positive; `rejPast`: the point has no place in the last image; `rejVignette`: near a border; `rejHistory`: the last image
 * kept another depth there); and `accepted`, the hit answered whole.
 */
export const REFLECTION_SCREEN_ENDS = [
  'noTrace',
  'noOrigin',
  'screensOff',
  'exhausted',
  'leftScreen',
  'behind',
  'rejPlane',
  'rejPast',
  'rejVignette',
  'rejHistory',
  'accepted',
] as const
export type ReflectionScreenEnd = (typeof REFLECTION_SCREEN_ENDS)[number]
/** Buckets of the march's steps: under 8, doubling, the last open. */
export const REFLECTION_WORK_BUCKETS = 12
export const REFLECTION_CENSUS = {
  screen: 0,
  left: 1,
  fates: 2,
  work: 2 + REFLECTION_FATES.length,
  workSum: 2 + REFLECTION_FATES.length + REFLECTION_WORK_BUCKETS,
  workMax: 3 + REFLECTION_FATES.length + REFLECTION_WORK_BUCKETS,
  ended: 4 + REFLECTION_FATES.length + REFLECTION_WORK_BUCKETS,
  /** The rays that ended `behind`, by how far behind the surface they stopped in thicknesses (under 2, 2 to 8, 8 to 32, over 32). */
  behindGap: 4 + REFLECTION_FATES.length + REFLECTION_WORK_BUCKETS + REFLECTION_SCREEN_ENDS.length,
  /** The same rays by the pyramid level of the last tile they passed above (0, 1, 2, 3 and over; the depth image is level 0). */
  behindMip: 8 + REFLECTION_FATES.length + REFLECTION_WORK_BUCKETS + REFLECTION_SCREEN_ENDS.length,
  /** The same rays by the iteration they stopped at (1 to 3, 4 to 10, 11 and over). */
  behindStep: 12 + REFLECTION_FATES.length + REFLECTION_WORK_BUCKETS + REFLECTION_SCREEN_ENDS.length,
  /** The rays that ended `leftScreen`: the one that never stepped, then the rest. */
  leftScreen: 15 + REFLECTION_FATES.length + REFLECTION_WORK_BUCKETS + REFLECTION_SCREEN_ENDS.length,
} as const
export const REFLECTION_CENSUS_WORDS = REFLECTION_CENSUS.leftScreen + 2

/** The index of a fate in `REFLECTION_FATES`. */
const fate = (name: ReflectionFate) => REFLECTION_FATES.indexOf(name)

/** The index of a reason in `REFLECTION_SCREEN_ENDS`. */
const ended = (name: ReflectionScreenEnd) => REFLECTION_SCREEN_ENDS.indexOf(name)

/**
 * How the last scene ray ended and the steps its march took, for the scene stage to count
 * (`reflectionSceneTrace` sets them): `reflectionFate` is a number of `REFLECTION_FATES`.
 */
export const REFLECTION_FATE_WGSL = wgslBlock(
  'REFLECTION_FATE_WGSL',
  [],
  `${wgslConsts({
    REFLECTION_FATE_NO_FIELD: fate('noField'),
    REFLECTION_FATE_HIT: fate('hit'),
    REFLECTION_FATE_OPEN: fate('open'),
    REFLECTION_FATE_BOUND: fate('bound'),
    REFLECTION_FATE_DISTANT: fate('distant'),
  })}
var<private> reflectionFate:u32;
var<private> reflectionWork:u32;`,
)

/**
 * The counters in a shader, their buffer at binding `binding` of group 0: `tallyAdd` counts in a word of
 * the workgroup's own, `flushTally`, which holds a workgroup barrier, adds the workgroup's words to the buffer, a
 * lane a word, and `censusWorkBucket` is the bucket of a march's steps.
 */
export const reflectionCensusWgsl = (binding: number) =>
  wgslBlock(
    `reflectionCensusWgsl(${binding})`,
    [
      REFLECTION_FATE_WGSL,
      workgroupTallyWgsl(
        'REFLECTION_CENSUS_TALLY_WGSL',
        REFLECTION_CENSUS_WORDS,
        REFLECTION_SIDE * REFLECTION_SIDE,
        'if(lane==REFLECTION_CENSUS_WORK_MAX){atomicMax(&reflectionCensus[lane],n);}else{atomicAdd(&reflectionCensus[lane],n);}',
      ),
    ],
    `${wgslConsts({
      REFLECTION_CENSUS_WORDS,
      REFLECTION_CENSUS_SCREEN: REFLECTION_CENSUS.screen,
      REFLECTION_CENSUS_LEFT: REFLECTION_CENSUS.left,
      REFLECTION_CENSUS_FATES: REFLECTION_CENSUS.fates,
      REFLECTION_CENSUS_WORK: REFLECTION_CENSUS.work,
      REFLECTION_CENSUS_WORK_SUM: REFLECTION_CENSUS.workSum,
      REFLECTION_CENSUS_WORK_MAX: REFLECTION_CENSUS.workMax,
      REFLECTION_CENSUS_ENDED: REFLECTION_CENSUS.ended,
      REFLECTION_CENSUS_BEHIND_GAP: REFLECTION_CENSUS.behindGap,
      REFLECTION_CENSUS_BEHIND_MIP: REFLECTION_CENSUS.behindMip,
      REFLECTION_CENSUS_BEHIND_STEP: REFLECTION_CENSUS.behindStep,
      REFLECTION_CENSUS_LEFT_SCREEN: REFLECTION_CENSUS.leftScreen,
      REFLECTION_WORK_BUCKETS,
      REFLECTION_ENDED_NO_TRACE: ended('noTrace'),
      REFLECTION_ENDED_NO_ORIGIN: ended('noOrigin'),
      REFLECTION_ENDED_SCREENS_OFF: ended('screensOff'),
      REFLECTION_ENDED_EXHAUSTED: ended('exhausted'),
      REFLECTION_ENDED_LEFT_SCREEN: ended('leftScreen'),
      REFLECTION_ENDED_BEHIND: ended('behind'),
      REFLECTION_ENDED_REJ_PLANE: ended('rejPlane'),
      REFLECTION_ENDED_REJ_PAST: ended('rejPast'),
      REFLECTION_ENDED_REJ_VIGNETTE: ended('rejVignette'),
      REFLECTION_ENDED_REJ_HISTORY: ended('rejHistory'),
      REFLECTION_ENDED_ACCEPTED: ended('accepted'),
    })}
@group(0) @binding(${binding}) var<storage,read_write> reflectionCensus:array<atomic<u32>,${REFLECTION_CENSUS_WORDS}>;
/** The workgroup's longest march so far, poured by a maximum. */
fn tallyMax(word:u32,n:u32){atomicMax(&tally[word],n);}
fn censusWorkBucket(steps:u32)->u32{
 let eighths=steps>>3u;
 return min(select(0u,firstLeadingBit(eighths)+1u,eighths>0u),REFLECTION_WORK_BUCKETS-1u);
}`,
  )
