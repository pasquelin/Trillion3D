import { BOUNCE_SETTINGS, PROBE_FLOATS } from '../../../sdk-core/src/index.ts';
import { irradianceShader } from '../../../sdk-core/src/scene/core/irradianceBasis.ts';

/**
 * The Lambert constant, 1/π, that both bounce passes apply to probe irradiance: the
 * surface cache and the per-pixel application divide by the same f32 literal.
 */
export const INVERSE_PI_WGSL = `const INVERSE_PI:f32=0.31830989;`;

/**
 * Probe cascades, as both the update pass and deferred resolve read them. One declaration:
 * both shaders name `bounce` and `probes`, so the same interpolation applies irradiance on a
 * pixel and rereads it at the point a ray hit — that second use is what gives higher-order
 * bounces.
 *
 * Each level is a cube of probes on a global lattice: a probe lives at the centre of its
 * cell, at `(cell + ½) · spacing`, and therefore never moves. A level that follows the
 * camera only changes the cells it holds; a cell is stored by its remainder modulo the
 * cube side, so sliding by one cell only invalidates the incoming slice. A probe itself
 * says which cell it carries: if that is not the one asked of it, it knows nothing of the
 * point and weighs nothing. The last level is world-fixed and covers the proxy extent.
 */
export const BOUNCE_GRID_WGSL = `
struct BounceLevel{originSpacing:vec4f,base:vec4f,}
struct BounceGrid{
 reach:vec4f,
 counts:vec4u,
 frame:vec4u,
 levels:array<BounceLevel,${BOUNCE_SETTINGS.cascadeLevels}>,
}
const PROBE_VECTORS:u32=${PROBE_FLOATS / 4}u;
const CASCADE_LEVELS:u32=${BOUNCE_SETTINGS.cascadeLevels}u;
/** The w lanes that carry a probe's state, slot by slot. */
const PROBE_CHANGE:u32=1u;
const PROBE_VALID:u32=2u;
/** The held cell occupies three consecutive slots from this one: x, then y, then z. */
const PROBE_CELL:u32=3u;
const PROBE_IDLE:u32=6u;
const PROBE_DISTANCE_POSITIVE:u32=9u;
const PROBE_DISTANCE_NEGATIVE:u32=10u;
const BOUNCE_VISIBILITY:f32=${BOUNCE_SETTINGS.visibilityMargin};
const BOUNCE_NORMAL_BIAS:f32=${BOUNCE_SETTINGS.normalBias};
/** Positive remainder of a cell modulo the cube side: the level's toroidal storage. */
fn probeWrap(cell:vec3i)->vec3u{
 let side=i32(bounce.counts.x);
 return vec3u(((cell%side)+side)%side);
}
/** A probe's rank in the buffer: its level, then its cell stored toroidally. */
fn probeSlot(level:u32,cell:vec3i)->u32{
 let wrapped=probeWrap(cell);
 let side=bounce.counts.x;
 return (level*bounce.counts.z+wrapped.x+side*(wrapped.y+side*wrapped.z))*PROBE_VECTORS;
}
/** World position of a cell: the global lattice, independent of the camera and of the level. */
fn probeCentre(cell:vec3i,spacing:f32)->vec3f{return (vec3f(cell)+vec3f(0.5))*spacing;}
/** The cell the probe says it carries. Different from the one sought: it knows nothing of here. */
fn probeCell(slot:u32)->vec3i{
 return vec3i(i32(probes[slot+PROBE_CELL].w),i32(probes[slot+PROBE_CELL+1u].w),i32(probes[slot+PROBE_CELL+2u].w));
}
/**
 * Irradiance of the probe's order-2 spherical harmonics, convolved with the cosine lobe — the
 * basis the scene environment evaluates (\`IRRADIANCE_TERMS\`). Never negative — a truncated
 * basis can go below zero where true irradiance cannot.
 */
fn shIrradiance(slot:u32,n:vec3f)->vec3f{
 return max(vec3f(0.0),${irradianceShader((k) => `probes[slot+${k}u].xyz`, 'n')});
}
/**
 * Mean distance the probe measured in a direction, interpolated among its six axes.
 * That is the visibility test: a point farther from the probe than this distance is behind
 * a surface the probe sees, hence in another room, and the probe has nothing to tell it.
 */
fn probeDistance(slot:u32,direction:vec3f)->f32{
 let positive=probes[slot+PROBE_DISTANCE_POSITIVE].xyz;
 let negative=probes[slot+PROBE_DISTANCE_NEGATIVE].xyz;
 let weight=abs(direction);
 let picked=select(negative,positive,direction>vec3f(0.0));
 return dot(picked,weight)/max(weight.x+weight.y+weight.z,1e-6);
}
/**
 * Irradiance of a level at a point, or nothing when that level does not reach it. Eight probes,
 * three weights: the cell's trilinear, the back of the surface — a probe behind it knows
 * nothing of it — and measured visibility, which closes leaks through walls. A probe that
 * does not carry the requested cell, was never updated, or is buried in a surface, weighs nothing.
 */
fn sampleLevel(level:u32,P:vec3f,N:vec3f)->vec4f{
 let spacing=bounce.levels[level].originSpacing.w;
 let base=vec3i(bounce.levels[level].base.xyz);
 let side=i32(bounce.counts.x);
 let biased=P+N*BOUNCE_NORMAL_BIAS*spacing;
 let local=biased/spacing-vec3f(0.5);
 let corner=vec3i(floor(local));
 // The level answers only if it holds all eight corners: a partial answer would make a seam.
 if(any(corner<base)||any(corner+vec3i(1)>=base+vec3i(side))){return vec4f(0.0);}
 let fraction=clamp(local-floor(local),vec3f(0.0),vec3f(1.0));
 let margin=BOUNCE_VISIBILITY*spacing;
 var sum=vec3f(0.0);
 var total=0.0;
 for(var index=0u;index<8u;index++){
  let offset=vec3u(index&1u,(index>>1u)&1u,(index>>2u)&1u);
  let cell=corner+vec3i(offset);
  let slot=probeSlot(level,cell);
  if(any(probeCell(slot)!=cell)){continue;}
  if(probes[slot+PROBE_VALID].w<0.5){continue;}
  let toProbe=probeCentre(cell,spacing)-biased;
  let distance=length(toProbe);
  let direction=toProbe/max(distance,1e-6);
  let trilinear=mix(vec3f(1.0)-fraction,fraction,vec3f(offset));
  var weight=trilinear.x*trilinear.y*trilinear.z;
  let facing=dot(direction,N)*0.5+0.5;
  weight*=facing*facing;
  if(distance>probeDistance(slot,-direction)+margin){weight=0.0;}
  if(weight<=0.0){continue;}
  sum+=shIrradiance(slot,N)*weight;
  total+=weight;
 }
 return vec4f(sum,total);
}
/**
 * Cascade irradiance at a point: the finest level that can answer, from tightest to
 * widest. When no level can, the result is exactly zero — a leak would be light without a source.
 */
fn sampleBounce(P:vec3f,N:vec3f)->vec3f{
 if(bounce.counts.w==0u){return vec3f(0.0);}
 for(var level=0u;level<CASCADE_LEVELS;level++){
  if(level>=bounce.counts.y){break;}
  let gathered=sampleLevel(level,P,N);
  if(gathered.w>1e-5){return gathered.xyz/gathered.w;}
 }
 return vec3f(0.0);
}`;
