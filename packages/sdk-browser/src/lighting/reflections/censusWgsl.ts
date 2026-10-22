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
 * ended: past the near field (`far`, the field answers all the screen left there), answered whole
 * with nothing left (`whole`), or left to the scene stage (`left`), which add up to the rays cast;
 * and, across them, those the screen answered in part or whole (`screen`: the march met a surface it
 * trusts). The scene stage counts each ray it takes once, by how its walk of the proxy ended
 * (`fates`, `REFLECTION_FATES`): no proxy at all, the four ways a walk is spent (its units, its
 * triangle tests, its tree steps, a mesh's walk — the causes a probe's ray reports, named by
 * `reflectionSpentFate`), a surface hit, the ray leaving the scene to the environment, a miss that
 * went nowhere (the field answers it), or no walk at all because the screen's surface was closer than
 * the proxy can tell; and, for the rays that walked, the units the walk spent (`work`: under 8, 16,
 * 32, 64, 128, 256, 512, more).
 *
 * A workgroup counts in its own memory and adds its words to the buffer once (`workgroupTallyWgsl`).
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
  far: 0,
  screen: 1,
  whole: 2,
  left: 3,
  fates: 4,
  work: 4 + REFLECTION_FATES.length,
} as const
export const REFLECTION_CENSUS_WORDS = REFLECTION_CENSUS.work + REFLECTION_WORK_BUCKETS
// The tally gives each word a lane of the trace's workgroup.
if (REFLECTION_CENSUS_WORDS > REFLECTION_SIDE * REFLECTION_SIDE)
  throw new RangeError(`the census holds more words than a workgroup has lanes`)

/** The index of a fate in `REFLECTION_FATES`. */
const fate = (name: ReflectionFate) => REFLECTION_FATES.indexOf(name)

/**
 * How the last proxy ray ended and the units it spent, for the scene stage to count
 * (`reflectionProxied` sets them): `reflectionFate` is a number of `REFLECTION_FATES`, a spent walk's
 * named from what spent it (`reflectionSpentFate`, `proxy.ts`).
 */
export const REFLECTION_FATE_WGSL = wgslBlock(
  'REFLECTION_FATE_WGSL',
  [],
  `${wgslConsts({
    REFLECTION_FATE_NO_PROXY: fate('noProxy'),
    REFLECTION_FATE_WORK: fate('work'),
    REFLECTION_FATE_TESTS: fate('tests'),
    REFLECTION_FATE_TREE: fate('tree'),
    REFLECTION_FATE_MESH: fate('mesh'),
    REFLECTION_FATE_HIT: fate('hit'),
    REFLECTION_FATE_OPEN: fate('open'),
    REFLECTION_FATE_MISS: fate('miss'),
    REFLECTION_FATE_BOUND: fate('bound'),
  })}
var<private> reflectionFate:u32;
var<private> reflectionWork:u32;`,
)

/**
 * The counters in a shader, their buffer at binding `binding` of group 0: `tallyAdd` counts in a word of
 * the workgroup's own, `flushTally`, which holds a workgroup barrier, adds the workgroup's words to the buffer, a
 * lane a word, and `censusWorkBucket` is the bucket of a walk's units.
 */
export const reflectionCensusWgsl = (binding: number) =>
  wgslBlock(
    `reflectionCensusWgsl(${binding})`,
    [
      REFLECTION_FATE_WGSL,
      workgroupTallyWgsl(
        'REFLECTION_CENSUS_TALLY_WGSL',
        REFLECTION_CENSUS_WORDS,
        'true',
        'atomicAdd(&reflectionCensus[lane],n);',
      ),
    ],
    `${wgslConsts({
      REFLECTION_CENSUS_WORDS,
      REFLECTION_CENSUS_FAR: REFLECTION_CENSUS.far,
      REFLECTION_CENSUS_SCREEN: REFLECTION_CENSUS.screen,
      REFLECTION_CENSUS_WHOLE: REFLECTION_CENSUS.whole,
      REFLECTION_CENSUS_LEFT: REFLECTION_CENSUS.left,
      REFLECTION_CENSUS_FATES: REFLECTION_CENSUS.fates,
      REFLECTION_CENSUS_WORK: REFLECTION_CENSUS.work,
      REFLECTION_WORK_BUCKETS,
    })}
@group(0) @binding(${binding}) var<storage,read_write> reflectionCensus:array<atomic<u32>,${REFLECTION_CENSUS_WORDS}>;
fn censusWorkBucket(units:u32)->u32{
 let eighths=units>>3u;
 return min(select(0u,firstLeadingBit(eighths)+1u,eighths>0u),REFLECTION_WORK_BUCKETS-1u);
}`,
  )
