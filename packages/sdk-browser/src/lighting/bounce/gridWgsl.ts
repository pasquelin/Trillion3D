import { wgslConsts } from '../../../../math/src/wgsl/consts.ts'
import { BOUNCE_SETTINGS } from '../../../../sdk-core/src/bounce/contracts.ts'
import { PROBE_AT_WGSL } from './atlas.ts'
import { BOUNCE_GRID, BOUNCE_LEVEL } from './uniform.ts'
import { irradianceShader } from '../../../../sdk-core/src/scene/core/irradianceBasis.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { perspectiveDivide } from '../../../../math/src/wgsl/projection.ts'
import { bitAt } from '../../../../math/src/wgsl/integer.ts'

/**
 * The levels of probes, as both the update pass and deferred resolve read them. One declaration:
 * both shaders name `bounce` and `probes`, the atlas read by `probeAt` and `tableEntry`
 * (`atlas.ts`), so the same interpolation applies irradiance on a pixel and rereads it at the point a
 * ray hit — that second use is what gives higher-order bounces.
 *
 * Each level is a cube of cells centred on the eye; a cell holds a probe only while the image reads
 * it, from a pool. A probe lives at the centre of its cell, `(cell + ½) · spacing`, and never moves.
 * The table of the atlas names the slot of the pool that holds a cell, by the cell's remainder
 * modulo the cube side: a level that follows the eye only changes the cells it holds, and sliding by
 * one cell only changes the entries of the cells that come in. A probe itself says which cell it
 * carries (and the level): if that is not the one asked of it, it holds no light for the point yet
 * and answers "not yet". A cell with no slot answers so too.
 */
export const BOUNCE_GRID_HEAD_WGSL = wgslBlock(
  'BOUNCE_GRID_HEAD_WGSL',
  [PROBE_AT_WGSL],
  `
${BOUNCE_LEVEL.wgsl}
${BOUNCE_GRID.wgsl}
${wgslConsts({ CASCADE_LEVELS: BOUNCE_SETTINGS.cascadeLevels })}
/** The w lanes that carry a probe's state, slot by slot. The state's lane holds one of three words:
 *  nothing (a probe never updated for the cell it carries), light, or buried in a surface. */
const PROBE_VALID:u32=2u;
const PROBE_EMPTY:f32=0.0;
const PROBE_USABLE:f32=1.0;
const PROBE_BURIED:f32=-1.0;
/** The held cell occupies three consecutive slots from this one: x, then y, then z. */
const PROBE_CELL:u32=3u;
const PROBE_IDLE:u32=6u;
/** The level the probe's cell is a cell of. */
const PROBE_LEVEL:u32=7u;
const PROBE_DISTANCE_POSITIVE:u32=9u;
const PROBE_DISTANCE_NEGATIVE:u32=10u;
const BOUNCE_VISIBILITY:f32=${BOUNCE_SETTINGS.visibilityMargin};
const BOUNCE_NORMAL_BIAS:f32=${BOUNCE_SETTINGS.normalBias};
/** Positive remainder of a cell modulo the cube side: the level's toroidal storage. */
fn probeWrap(cell:vec3i)->vec3u{
 let side=i32(bounce.counts.x);
 return vec3u(((cell%side)+side)%side);
}
/** A level's low corner in the world: its lowest cell times its spacing. */
fn bounceLevelLow(level:u32)->vec3f{
 return bounce.levels[level].base*bounce.levels[level].spacing;
}
/**
 * Where a level reads a surface at \`P\` of normal \`N\`: the point pushed off it by the normal bias
 * (\`biased\`), in the level's cells half a cell back (\`local\`, a probe's centre on an integer), the
 * first of the eight probes around it (\`corner\`), whether the level holds all eight (\`holds\`): a
 * partial answer would make a seam —, and its share of the answer (\`fade\`): one a cell inside the
 * level's edge, falling to nothing at it, the next level answering the rest, so that no level's edge
 * is a line in the image. The one rule of the levels that answer a point: the field reads by it
 * (\`probeFieldWgsl\`), the reflections' proxy ray is cut by it (\`reach.ts\`).
 */
struct BounceRead{biased:vec3f,local:vec3f,corner:vec3i,holds:bool,fade:f32,}
fn bounceRead(level:u32,P:vec3f,N:vec3f)->BounceRead{
 let spacing=bounce.levels[level].spacing;
 let base=vec3i(bounce.levels[level].base);
 let biased=P+N*BOUNCE_NORMAL_BIAS*spacing;
 let local=biased/spacing-vec3f(0.5);
 let corner=vec3i(floor(local));
 let last=vec3f(base+vec3i(i32(bounce.counts.x)-1));
 let holds=all(corner>=base)&&all(corner+vec3i(1)<base+vec3i(i32(bounce.counts.x)));
 let inside=min(local-vec3f(base),last-local);
 return BounceRead(biased,local,corner,holds,clamp(min(inside.x,min(inside.y,inside.z)),0.0,1.0));
}
/** World position of a cell: the global lattice, independent of the camera and of the level. */
fn probeCentre(cell:vec3i,spacing:f32)->vec3f{return (vec3f(cell)+vec3f(0.5))*spacing;}
/** The cell the probe says it carries, and its level. Different from the one sought: it holds nothing of here yet. */
fn probeCell(probe:vec3u)->vec3i{
 return vec3i(i32(probeAt(probe,PROBE_CELL).w),i32(probeAt(probe,PROBE_CELL+1u).w),i32(probeAt(probe,PROBE_CELL+2u).w));
}
fn probeLevel(probe:vec3u)->u32{return u32(probeAt(probe,PROBE_LEVEL).w);}
/** The entry of the table for the cell of a level whose remainders modulo the side are \`wrapped\`:
 *  \`ProbeSlots.entryAt\`'s order, level, z, y, x. */
fn cellEntry(level:u32,wrapped:vec3u)->u32{
 let side=bounce.counts.x;
 return ((level*side+wrapped.z)*side+wrapped.y)*side+wrapped.x;
}
/**
 * Irradiance of the probe's order-2 spherical harmonics, convolved with the cosine lobe — the
 * basis the scene environment evaluates (\`IRRADIANCE_TERMS\`). Never negative — a truncated
 * basis can go below zero where true irradiance cannot.
 */
fn shIrradiance(probe:vec3u,n:vec3f)->vec3f{
 return max(vec3f(0.0),${irradianceShader((k) => `probeAt(probe,${k}u).xyz`, 'n')});
}
/**
 * The mean distance of a probe's six axes (\`positive\`, \`negative\`: its two distance vectors) in a
 * direction, interpolated among them.
 */
fn distanceAlong(positive:vec3f,negative:vec3f,direction:vec3f)->f32{
 let weight=abs(direction);
 let picked=select(negative,positive,direction>vec3f(0.0));
 return dot(picked,weight)/max(weight.x+weight.y+weight.z,1e-6);
}
/**
 * Mean distance the probe measured in a direction, interpolated among its six axes.
 * That is the visibility test: a point farther from the probe than this distance is behind
 * a surface the probe sees, hence in another room, and the probe has nothing to tell it.
 */
fn probeDistance(probe:vec3u,direction:vec3f)->f32{
 return distanceAlong(probeAt(probe,PROBE_DISTANCE_POSITIVE).xyz,probeAt(probe,PROBE_DISTANCE_NEGATIVE).xyz,direction);
}
`,
)

/** The levels' uniform (`bounce`) and atlas (`probes`) at bindings `grid` and `probes` of
 *  group `group`: every program that reads the levels declares them so. */
export const bounceBindingsWgsl = (group: number, grid: number, probes: number) =>
  wgslBlock(
    `bounceBindingsWgsl(${group}, ${grid}, ${probes})`,
    [BOUNCE_GRID_HEAD_WGSL],
    `@group(${group}) @binding(${grid}) var<uniform> bounce:BounceGrid;
@group(${group}) @binding(${probes}) var probes:texture_2d_array<f32>;`,
  )

/** The WGSL of a field's answer over its `count` values (one or two): its type, one value a `vec4f`,
 *  two a `mat2x4f` of a column each; `answer`, the answer of one column each value (`column(i)`);
 *  `column`, the `i`-th column of an answer `of` — the first's `w` the share every column carries. */
const fieldAnswer = (count: number) => {
  const pair = count === 2
  return {
    type: pair ? 'mat2x4f' : 'vec4f',
    none: pair ? 'mat2x4f()' : 'vec4f(0.0)',
    answer: (column: (i: number) => string) =>
      pair ? `mat2x4f(${column(0)},${column(1)})` : column(0),
    column: (of: string, i: number) => (pair ? `${of}[${i}]` : of),
  }
}

/** The sum of the `i`-th value. */
const sumOf = (i: number) => (i === 0 ? 'sum' : `sum${i}`)

/** One statement of WGSL a value, `line(sum, i)` for the sum of the `i`-th, joined at `indent`. */
const perValue = (
  values: readonly string[],
  line: (sum: string, i: number) => string,
  indent = ' ',
) => values.map((_, i) => line(sumOf(i), i)).join(`\n${indent}`)

/** What the texts of a field are written from: its names, its parameters and the arguments that pass them
 *  on, its values and the shape of its answer (`fieldAnswer`). */
type Field = ReturnType<typeof fieldAnswer> & {
  name: string
  level: string
  params: string
  args: string
  values: readonly string[]
}

/** The WGSL of a field's level (`level`): the eight probes round a point of one level, weighed, summed. */
const fieldLevelWgsl = ({ name, level, params, type, none, answer, values }: Field) =>
  wgslBlock(
    `fieldLevelWgsl(${name})`,
    [BOUNCE_GRID_HEAD_WGSL, bitAt],
    `fn ${level}(level:u32,P:vec3f,N:vec3f${params})->${type}{
 let read=bounceRead(level,P,N);
 if(!read.holds){return ${none};}
 let spacing=bounce.levels[level].spacing;
 let biased=read.biased;
 let corner=read.corner;
 let fraction=clamp(read.local-floor(read.local),vec3f(0.0),vec3f(1.0));
 let margin=BOUNCE_VISIBILITY*spacing;
 ${perValue(values, (sum) => `var ${sum}=vec3f(0.0);`)}
 var total=0.0;
 var unanswered=0.0;
 // A corner's neighbour one cell further on an axis has the next remainder, wrapped once at
 // the side: one remainder per axis for the eight corners, where each corner took its own.
 let wrappedCorner=probeWrap(corner);
 let wrapAt=vec3u(bounce.counts.x);
 for(var index=0u;index<8u;index++){
  let offset=vec3u(bitAt(index,0u),bitAt(index,1u),bitAt(index,2u));
  let cell=corner+vec3i(offset);
  let next=wrappedCorner+offset;
  let slot=tableEntry(cellEntry(level,select(next,vec3u(0u),next>=wrapAt)));
  let trilinear=mix(vec3f(1.0)-fraction,fraction,vec3f(offset));
  var weight=trilinear.x*trilinear.y*trilinear.z;
  let probe=poolProbe(max(slot,1u)-1u);
  if(slot==0u||any(probeCell(probe)!=cell)||probeLevel(probe)!=level){unanswered+=weight;continue;}
  let state=probeAt(probe,PROBE_VALID).w;
  if(state==PROBE_EMPTY){unanswered+=weight;continue;}
  if(state==PROBE_BURIED){continue;}
  let toProbe=probeCentre(cell,spacing)-biased;
  let distance=length(toProbe);
  let direction=toProbe/max(distance,1e-6);
  let facing=dot(direction,N)*0.5+0.5;
  weight*=facing*facing;
  if(distance>probeDistance(probe,-direction)+margin){weight=0.0;}
  if(weight<=0.0){continue;}
  ${perValue(values, (sum, i) => `${sum}+=${values[i]}*weight;`, '  ')}
  total+=weight;
 }
 if(total<=1e-5){return ${none};}
 return ${answer((i) => `vec4f(${sumOf(i)},total)*(read.fade*(1.0-unanswered)/total)`)};
}`,
  )

/**
 * A field of the levels, written once for every field they hold: `name` at a point is the levels
 * that can answer, from tightest to widest, each taking its share (`BounceRead.fade`) of what the
 * finer ones left — exactly zero when none can, since a leak would be light without a source —, and
 * a level's answer (`level`) the eight probes around the point,
 * weighed, each evaluated by `value` (a shader expression of `probe`, `N` and the `params` the
 * field takes beyond the point `P` and its normal `N`). A level answers a point or nothing, when
 * it does not reach it: eight probes, three weights — the cell's trilinear, the back of the
 * surface (a probe behind it knows nothing of it) and measured visibility, which closes leaks
 * through walls; a probe buried in a surface weighs nothing. A cell no probe holds, a probe that
 * does not carry the requested cell, or was never updated for it, holds no light yet: its trilinear share of the point
 * is left unanswered, never counted as dark and never renormalised away, so the share goes on to the
 * next level and, past the last, to the sky light where one shines (`indirectGathered`). A level
 * whose probes all weigh nothing leaves its share to the next.
 * `${name}Gathered` is the levels' answer with the share they hold in `w`, at most one, zero when none
 * answers — the reflections' confidence in the field; `name` is its mean. With two `value`s, both are
 * evaluated from the one gather, on the same weights — the very sums each would take alone —, a
 * column each of the `mat2x4f` `${name}Gathered` answers.
 */
export const probeFieldWgsl = (
  name: string,
  level: string,
  params: string,
  value: string | readonly [string, string],
) => {
  const values = typeof value === 'string' ? [value] : value
  const args = params.replace(/:[^,]+/g, '')
  const field: Field = { name, level, params, args, values, ...fieldAnswer(values.length) }
  const { type, none, answer, column } = field
  return wgslBlock(
    `probeFieldWgsl(${name})`,
    [fieldLevelWgsl(field), perspectiveDivide],
    `fn ${name}Gathered(P:vec3f,N:vec3f${params})->${type}{
 if(bounce.counts.w==0u){return ${none};}
 ${perValue(values, (sum) => `var ${sum}=vec3f(0.0);`)}
 var rest=1.0;
 for(var level=0u;level<CASCADE_LEVELS;level++){
  if(level>=bounce.counts.y||rest<=1e-5){break;}
  let gathered=${level}(level,P,N${args});
  if(${column('gathered', 0)}.w<=0.0){continue;}
  let take=rest*${column('gathered', 0)}.w;
  ${perValue(values, (sum, i) => `${sum}+=take*perspectiveDivide(${column('gathered', i)});`, '  ')}
  rest-=take;
 }
 let held=1.0-rest;
 if(held<=0.0){return ${none};}
 return ${answer((i) => `vec4f(${sumOf(i)}/held,held)`)};
}${
      values.length === 2
        ? ''
        : `
fn ${name}(P:vec3f,N:vec3f${params})->vec3f{return ${name}Gathered(P,N${args}).xyz;}`
    }`,
  )
}

/** A probe's irradiance at the normal `N`, the value of the field the diffuse reads. */
export const PROBE_IRRADIANCE = 'shIrradiance(probe,N)'

/** The cascades' irradiance at a point of normal `N` (`sampleBounce`), what the diffuse reads. */
export const BOUNCE_GRID_WGSL = probeFieldWgsl(
  'sampleBounce',
  'sampleLevelField',
  '',
  PROBE_IRRADIANCE,
)
