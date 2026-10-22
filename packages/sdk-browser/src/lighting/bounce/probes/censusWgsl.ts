import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { bounceBindingsWgsl } from '../gridWgsl.ts'
import { CENSUS_BINDINGS } from './probeBindings.ts'

/**
 * THE CENSUS OF THE PROBES, the one buffer of counters the field's state is read from. Its first
 * words are totals since the probes were made, added by the update (`updateProbes`): the probes that
 * fired their rays, the rays fired (every one answers), those that brought light back, the probes
 * written, the probes written buried; the rays that spent their budget, by what spent it
 * (`exhaustedBy`: the ray's own work, its triangle tests, its walk of the placement tree, a mesh's walk;
 * then the same four for its shadow ray — an exhausted walk ends as a hit where it stopped, an exhausted
 * shadow ray as a blocker, and a ray may count in two); every ray by the work it spent (`work`: under 64
 * units, under 128, 256, 512, 1024, 2048, 4096, more); the rays that answered by meeting no surface
 * (`escaped`: the sky answers them) and the shadow rays that came back, by what they found
 * (`shadowFree`: nothing stood on the segment, the point is lit; `shadowBlocked`: a surface did).
 * The last words are the field as the last census found it, cleared then counted by `countField`
 * over the whole pool and the whole table: the probes that hold light, those that hold none, those
 * buried, the entries of the table that name a probe; and, cleared with them, the work the rays of
 * that image spent (`walk`): all of it, and the share the placement tree's groups took — a ray that
 * meets a group's box reads every member of it —, the rest being the tree's cells and the cuts'. The
 * update counts in its workgroup's own memory and adds to the buffer once (`../../censusTallyWgsl.ts`).
 */
export const CENSUS_WORDS = 30
/** Words the exhaustion causes and the work buckets take. */
export const CENSUS_CAUSES = 8
export const CENSUS_BUCKETS = 8
export const CENSUS = {
  updated: 0,
  fired: 1,
  lit: 2,
  written: 3,
  buried: 4,
  exhaustedBy: 5,
  work: 13,
  escaped: 21,
  shadowFree: 22,
  shadowBlocked: 23,
  /** The field's words begin here: they are cleared before each census. */
  field: 24,
  fieldLit: 24,
  fieldDark: 25,
  fieldBuried: 26,
  fieldPublished: 27,
  /** The work of the rays of the image counted — cleared with the field, added by its update: all of it, and
   *  the part the tree's groups took. */
  walkWork: 28,
  walkMembers: 29,
} as const

/** The counters' names in a shader, and their buffer at binding `binding` of group 0. */
export const censusWgsl = (binding: number) =>
  wgslBlock(
    `censusWgsl(${binding})`,
    [],
    `${wgslConsts({
      CENSUS_UPDATED: CENSUS.updated,
      CENSUS_FIRED: CENSUS.fired,
      CENSUS_LIT: CENSUS.lit,
      CENSUS_WRITTEN: CENSUS.written,
      CENSUS_BURIED: CENSUS.buried,
      CENSUS_EXHAUSTED_BY: CENSUS.exhaustedBy,
      CENSUS_WORK: CENSUS.work,
      CENSUS_BUCKETS,
      CENSUS_ESCAPED: CENSUS.escaped,
      CENSUS_SHADOW_FREE: CENSUS.shadowFree,
      CENSUS_SHADOW_BLOCKED: CENSUS.shadowBlocked,
      CENSUS_FIELD_LIT: CENSUS.fieldLit,
      CENSUS_FIELD_DARK: CENSUS.fieldDark,
      CENSUS_FIELD_BURIED: CENSUS.fieldBuried,
      CENSUS_FIELD_PUBLISHED: CENSUS.fieldPublished,
      CENSUS_WALK_WORK: CENSUS.walkWork,
      CENSUS_WALK_MEMBERS: CENSUS.walkMembers,
    })}
@group(0) @binding(${binding}) var<storage,read_write> census:array<atomic<u32>,${CENSUS_WORDS}>;`,
  )

/**
 * The field's census: a thread a probe of the pool, then a thread a texel of the table. A probe that
 * holds light (its state a light, its first coefficient not zero), one that holds none, one buried;
 * a table texel adds the entries it holds that name a probe. It counts what the lit passes read:
 * the probes they find in the table, and the light those hold.
 */
export const BOUNCE_CENSUS_SHADER = wgslProgram(
  `@compute @workgroup_size(WORKGROUP_THREADS)
fn countField(@builtin(global_invocation_id) id:vec3u){
 let pool=bounce.counts.w;
 if(id.x<pool){
  let probe=poolProbe(id.x);
  let state=probeAt(probe,PROBE_VALID).w;
  if(state==PROBE_BURIED){atomicAdd(&census[CENSUS_FIELD_BURIED],1u);}
  if(state==PROBE_USABLE){
   let light=probeAt(probe,0u).xyz;
   atomicAdd(&census[select(CENSUS_FIELD_DARK,CENSUS_FIELD_LIT,any(light>vec3f(0.0)))],1u);
  }
  return;
 }
 let texel=id.x-pool;
 if(texel*TABLE_LANES>=bounce.counts.y*bounce.counts.z){return;}
 let lanes=textureLoad(probes,vec2u(texel%TABLE_WIDTH,texel/TABLE_WIDTH),TABLE_LAYER,0);
 var named=0u;
 for(var lane=0u;lane<TABLE_LANES;lane++){named+=select(0u,1u,lanes[lane]>0.0);}
 if(named>0u){atomicAdd(&census[CENSUS_FIELD_PUBLISHED],named);}
}`,
  [
    bounceBindingsWgsl(0, CENSUS_BINDINGS.grid, CENSUS_BINDINGS.probes),
    censusWgsl(CENSUS_BINDINGS.census),
    WORKGROUP_THREADS_WGSL,
  ],
)
