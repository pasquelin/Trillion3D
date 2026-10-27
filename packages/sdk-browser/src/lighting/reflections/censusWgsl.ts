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
 * light), the ray leaving the scene to the environment, the screen's far trace answering it (`distant`, `wgsl.ts`), a
 * miss that went nowhere (the field answers it: the march met a surface none of the cards near it gave any light of), or no march
 * at all because the screen followed the ray to the longest ray; and, for the rays that marched, the steps the march took (`work`: under 8, 16, 32, 64, 128, 256,
 * 512, 1 024, 2 048, 4 096, 8 192, more).
 *
 * A workgroup counts in its own memory and adds its words to the buffer once (`workgroupTallyWgsl`).
 */
export const REFLECTION_FATES = ['noField', 'hit', 'open', 'miss', 'bound', 'distant'] as const
export type ReflectionFate = (typeof REFLECTION_FATES)[number]
/** Buckets of the march's steps: under 8, doubling, the last open. */
export const REFLECTION_WORK_BUCKETS = 12
export const REFLECTION_CENSUS = {
  screen: 0,
  left: 1,
  fates: 2,
  work: 2 + REFLECTION_FATES.length,
} as const
export const REFLECTION_CENSUS_WORDS = REFLECTION_CENSUS.work + REFLECTION_WORK_BUCKETS

/** The index of a fate in `REFLECTION_FATES`. */
const fate = (name: ReflectionFate) => REFLECTION_FATES.indexOf(name)

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
    REFLECTION_FATE_MISS: fate('miss'),
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
        'atomicAdd(&reflectionCensus[lane],n);',
      ),
    ],
    `${wgslConsts({
      REFLECTION_CENSUS_WORDS,
      REFLECTION_CENSUS_SCREEN: REFLECTION_CENSUS.screen,
      REFLECTION_CENSUS_LEFT: REFLECTION_CENSUS.left,
      REFLECTION_CENSUS_FATES: REFLECTION_CENSUS.fates,
      REFLECTION_CENSUS_WORK: REFLECTION_CENSUS.work,
      REFLECTION_WORK_BUCKETS,
    })}
@group(0) @binding(${binding}) var<storage,read_write> reflectionCensus:array<atomic<u32>,${REFLECTION_CENSUS_WORDS}>;
fn censusWorkBucket(steps:u32)->u32{
 let eighths=steps>>3u;
 return min(select(0u,firstLeadingBit(eighths)+1u,eighths>0u),REFLECTION_WORK_BUCKETS-1u);
}`,
  )
