/**
 * THE DIFF OF THE INSTANCES' BOXES (`castDiff.ts`): one thread a placement, comparing the box and the
 * word it has now with the ones it was last seen with, and appending to the shadow changes
 * (`castChanges.ts`) the boxes whose pages are stale. The reference invalidates an instance by its
 * bounds, the one it leaves and the one it enters, each in the layer its cache state names: a
 * placement that moved appends the box of its previous pose, in the layer it was cached in, and the
 * box of its new one, in the layer it is cached in now; one that began to cast, or arrived, its new
 * box; one that stopped casting, or left, its previous; one whose cache state or far-shadow flags
 * changed where it stands, its box once; one that arrived where it was seen cast (a row seated on another mesh is another primitive,
 * removed and added: its previous box in the layer it was cached in, its new one in the layer it is cached in now) both, whatever
 * its box. A placement cached as dynamic is a box of casters already
 * moving (sign `-1`): the static layer never held it; so is one that deforms. Beside the sign, a box
 * carries the placement's offset facts (it wears an offset that invalidates its shadows, one that
 * always evaluates, and the square of the distance past which its object stops evaluating it), from
 * which the stale decides, map by map, the layer the box was cached in (`vsmCachesAsStatic`). A
 * placement whose transform never invalidates its cache (`MOBILITY_CACHE_STATIC`) is followed without a record for its moves. The first diff of
 * a memory made anew (`quiet`) remembers every placement and appends none. Beside the bounds, the
 * instance's cache-as-dynamic state: a tracked placement that began to deform appends its box in
 * the dynamic layer alone, the static one kept; its stop appends nothing; a rank that arrives starts
 * with none.
 *
 *   diff        uniform         the placements, and whether this diff only remembers
 *   rootBoxes   array<vec2u>    `ROOT_BOX_DOUBLES` a placement: its world box, its stretch, its ball, its half axes
 *                               (`../../../placement/roots/rootBoxesWgsl.ts`)
 *   rootWords   array<u32>      a placement's mobility word (`../mobilityBits.ts`)
 *   rootWorlds  array<vec2u>    sixteen doubles a placement: its world, written by the host's send or
 *                               by the composition
 *   arrived     array<u32>      a bit a placement, set for the ones that arrived since the state per view
 *                               last ran (\`diff.arrivals\` says any): they start with no cache state in
 *                               any view
 *   castState   array<u32>      `CAST_STATE_WORDS` a placement: its oriented box as it was, its word, its flags,
 *                               a digest of its world
 *   castChanges array<atomic>   the list (`castChanges.ts`)
 *
 * A box is the placement's oriented box — the reference invalidates an instance by its local bounds
 * carried by its transform: its centre and three half axes, rounded to single precision and widened
 * by `BOX_SLACK` of their magnitudes, so that no rounding leaves a page out; one that bounds nothing finite is the box
 * holding the world (`UNBOUNDED_EXTENT`), as the CPU's boxes are (`../vsm/invalidation/castBoxes.ts`).
 */
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { wgslConsts } from '../../../../../math/src/wgsl/consts.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { toF32 } from '../../../../../math/src/wgsl/f32.ts'
import { FLAT_INDEX_WGSL, WORKGROUP_THREADS_WGSL } from '../../../gpu/dispatch/grid.ts'
import { MATRIX_VALUES } from '../../../../../math/src/batch/strides.ts'
import { bitIsSet, bitWord } from '../../../../../math/src/wgsl/integer.ts'
import { ROOT_BOX_AXES, ROOT_BOX_DOUBLES } from '../../../placement/roots/rootWorldSends.ts'
import { UNBOUNDED_EXTENT_WGSL } from '../../../deformation/halfFloat.ts'
import {
  MOBILITY_CACHE_STATIC,
  MOBILITY_CAST_BITS,
  MOBILITY_DEFORMS,
  MOBILITY_MOVING,
  MOBILITY_OFFSET_ALWAYS,
  MOBILITY_OFFSET_INVALIDATES,
  MOBILITY_SHADOWLESS,
} from '../mobilityBits.ts'
import { CAST_BOXED, CAST_SEEN, CAST_STATE_WORDS, CAST_VIEWS_WORD } from './castChanges.ts'
import { CAST_EMIT_WGSL } from './castChangesWgsl.ts'
import { ROOT_SECTION, ROOT_WORDS_WGSL } from './rootWordsWgsl.ts'

/** The share of a bound's magnitude a box is widened by: the single rounding of a double, and of the
 *  centre and extent a record is made of, with room to spare. */
const BOX_SLACK = 2 ** -22

/** Bytes of the diff's parameters (`CastDiffParams`). */
export const CAST_DIFF_PARAMS_BYTES = 16

/** The diff's entry, and the instances' state's. */
export const CAST_DIFF_ENTRY = 'castDiff'
export const CAST_INSTANCE_STATE_ENTRY = 'castInstanceState'

export const CAST_DIFF_WGSL = wgslProgram(
  /* wgsl */ `
struct CastDiffParams{roots:u32,quiet:u32,views:u32,arrivals:u32,}
@group(0) @binding(0) var<uniform> diff:CastDiffParams;
@group(0) @binding(1) var<storage,read> rootBoxes:array<vec2u>;
@group(0) @binding(2) var<storage,read_write> rootWords:array<u32>;
@group(0) @binding(3) var<storage,read_write> castState:array<u32>;
@group(0) @binding(4) var<storage,read_write> castChanges:array<atomic<u32>>;
@group(0) @binding(5) var<storage,read> rootWorlds:array<vec2u>;
@group(0) @binding(6) var<storage,read> arrived:array<u32>;
${wgslConsts({
  MOBILITY_MOVING,
  MOBILITY_SHADOWLESS,
  MOBILITY_DEFORMS,
  MOBILITY_CACHE_STATIC,
  MOBILITY_CAST_BITS,
  MOBILITY_OFFSET_ALWAYS,
  MOBILITY_OFFSET_INVALIDATES,
  CAST_SEEN,
  CAST_BOXED,
  CAST_STATE_WORDS,
  CAST_VIEWS_WORD,
  ROOT_BOX_DOUBLES,
  ROOT_BOX_AXES,
  MATRIX_VALUES,
})}
const BOX_SLACK:f32=${wgslF32(BOX_SLACK)};
struct InstanceBox{centre:vec3f,ax:vec3f,ay:vec3f,az:vec3f,has:bool,}
/** A bound of a world box, rounded to single precision. */
fn bound(d:vec2u)->f32{return bitcast<f32>(toF32(d));}
/** The \`k\`th single of placement \`o\`'s oriented box words (nine singles in the doubles after the ball). */
fn boxAxis(o:u32,c:u32)->vec3f{
 var v=vec3f(0.0);
 for(var a=0u;a<3u;a++){
  let k=3u*c+a;
  let d=rootBoxes[o+${ROOT_BOX_AXES}u+k/2u];
  v[a]=bitcast<f32>(select(d.x,d.y,(k&1u)==1u));
 }
 return v;
}
/** A half axis widened by the rounding of the box: by its own magnitude, and \`pad\` along it. */
fn widened(axis:vec3f,pad:f32)->vec3f{
 let len=length(axis);
 return axis*(1.0+BOX_SLACK)+select(vec3f(0.0),axis*(pad/len),len>0.0);
}
/** Placement \`r\`'s oriented world box as a record keeps it: none for a placement whose boxes are zero;
 *  the box holding the world for one that bounds nothing finite. Its centre and half axes are the roots
 *  pass's (\`composeRoot\`), rounded to single precision and widened by \`BOX_SLACK\` of the
 *  magnitudes they are made of, so that no rounding leaves a page out. */
fn instanceBox(r:u32)->InstanceBox{
 var b:InstanceBox;
 b.has=false;
 let o=r*ROOT_BOX_DOUBLES;
 if(o+ROOT_BOX_DOUBLES>arrayLength(&rootBoxes)){return b;}
 var nonZero=false;
 for(var k=0u;k<6u;k++){nonZero=nonZero||rootBoxes[o+k].x!=0u||rootBoxes[o+k].y!=0u;}
 if(!nonZero){return b;}
 let lo=vec3f(bound(rootBoxes[o]),bound(rootBoxes[o+1u]),bound(rootBoxes[o+2u]));
 let hi=vec3f(bound(rootBoxes[o+3u]),bound(rootBoxes[o+4u]),bound(rootBoxes[o+5u]));
 b.has=true;
 let centre=vec3f(bound(rootBoxes[o+7u]),bound(rootBoxes[o+8u]),bound(rootBoxes[o+9u]));
 let ax=boxAxis(o,0u);let ay=boxAxis(o,1u);let az=boxAxis(o,2u);
 let finite=all(lo==lo)&&all(hi==hi)&&all(hi>=lo)&&all(abs(lo)<vec3f(UNBOUNDED_EXTENT))&&all(abs(hi)<vec3f(UNBOUNDED_EXTENT))
  &&all(centre==centre)&&all(abs(centre)<vec3f(UNBOUNDED_EXTENT))
  &&all(ax==ax)&&all(ay==ay)&&all(az==az)&&all(abs(ax)<vec3f(UNBOUNDED_EXTENT))&&all(abs(ay)<vec3f(UNBOUNDED_EXTENT))&&all(abs(az)<vec3f(UNBOUNDED_EXTENT));
 if(!finite){
  b.centre=vec3f(0.0);
  b.ax=vec3f(UNBOUNDED_EXTENT,0.0,0.0);b.ay=vec3f(0.0,UNBOUNDED_EXTENT,0.0);b.az=vec3f(0.0,0.0,UNBOUNDED_EXTENT);
  return b;
 }
 let pad=max(max(abs(centre.x),abs(centre.y)),abs(centre.z))*BOX_SLACK;
 b.centre=centre;
 b.ax=widened(ax,pad);b.ay=widened(ay,pad);b.az=widened(az,pad);
 return b;
}
/** Whether placement \`r\` arrived since the state per view last ran. */
fn arrivedSince(r:u32)->bool{return diff.arrivals!=0u&&bitWord(r)<arrayLength(&arrived)&&bitIsSet(arrived[bitWord(r)],r);}
/** The bits of a word the stale reads of a box: its offset invalidates, always evaluated (the layer it was
 *  cached in), and the placement casts no shadow (the stale skips the box). */
fn offsetFacts(word:u32)->u32{return word&(MOBILITY_OFFSET_INVALIDATES|MOBILITY_OFFSET_ALWAYS|MOBILITY_SHADOWLESS);}
/** Whether a word's placement is cached as dynamic: it moves or it deforms. */
fn cachedDynamic(word:u32)->bool{return (word&(MOBILITY_MOVING|MOBILITY_DEFORMS))!=0u;}
/** Appends the oriented box \`b\` of a placement whose word is \`word\`, \`disableSq\` its offset's distance. */
fn emitBox(b:InstanceBox,dynamic:bool,views:u32,word:u32,disableSq:f32){
 emitCast(b.centre,b.ax,b.ay,b.az,dynamic,views,offsetFacts(word),disableSq);
}
/** Stores \`b\` as placement state \`at\`: its centre, its half axes (zero for a placement with no box). */
fn storeBox(at:u32,b:InstanceBox){
 let v=b;
 castState[at]=bitcast<u32>(v.centre.x);castState[at+1u]=bitcast<u32>(v.centre.y);castState[at+2u]=bitcast<u32>(v.centre.z);
 castState[at+4u]=bitcast<u32>(v.ax.x);castState[at+5u]=bitcast<u32>(v.ax.y);castState[at+6u]=bitcast<u32>(v.ax.z);
 castState[at+11u]=bitcast<u32>(v.ay.x);castState[at+12u]=bitcast<u32>(v.ay.y);castState[at+13u]=bitcast<u32>(v.ay.z);
 castState[at+14u]=bitcast<u32>(v.az.x);castState[at+15u]=bitcast<u32>(v.az.y);castState[at+16u]=bitcast<u32>(v.az.z);
}
fn storedVec(at:u32,first:u32)->vec3f{
 return vec3f(bitcast<f32>(castState[at+first]),bitcast<f32>(castState[at+first+1u]),bitcast<f32>(castState[at+first+2u]));
}
/** The box placement state \`at\` holds. */
fn storedBox(at:u32,has:bool)->InstanceBox{
 return InstanceBox(storedVec(at,0u),storedVec(at,4u),storedVec(at,11u),storedVec(at,14u),has);
}
fn sameBox(a:InstanceBox,b:InstanceBox)->bool{
 return all(a.centre==b.centre)&&all(a.ax==b.ax)&&all(a.ay==b.ay)&&all(a.az==b.az);
}
/** A digest of placement \`r\`'s world, its sixteen doubles: two words from two multiplicative mixes,
 *  so that any change of the transform — a rotation that leaves the box as it was — is told. */
fn worldDigest(r:u32)->vec2u{
 var a=2166136261u;var b=2654435769u;
 let o=r*MATRIX_VALUES;
 if(o+MATRIX_VALUES>arrayLength(&rootWorlds)){return vec2u(a,b);}
 for(var k=0u;k<MATRIX_VALUES;k++){
  let w=rootWorlds[o+k];
  a=(a^w.x)*16777619u;a=(a^w.y)*16777619u;
  b=(b^w.y)*2246822519u;b=(b^w.x)*3266489917u;b^=b>>15u;
 }
 return vec2u(a,b);
}
@compute @workgroup_size(WORKGROUP_THREADS) fn ${CAST_DIFF_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let r=flatIndex(id,n,WORKGROUP_THREADS);
 if(r>=diff.roots){return;}
 let at=r*CAST_STATE_WORDS;
 if(at+CAST_STATE_WORDS>arrayLength(&castState)){return;}
 let cur=instanceBox(r);
 let roots=vsmRootWords(r);
 let was=castState[at+7u];
 let seen=(was&CAST_SEEN)!=0u;
 let wasBoxed=(was&CAST_BOXED)!=0u;
 let wasWord=castState[at+3u];
 let wasBox=storedBox(at,wasBoxed);
 let digest=worldDigest(r);
 let worldMoved=seen&&any(digest!=vec2u(castState[at+8u],castState[at+9u]));
 // Remembered as it stands now, whatever follows.
 storeBox(at,cur);
 castState[at+3u]=roots.word;
 castState[at+7u]=CAST_SEEN|select(0u,CAST_BOXED,cur.has);
 castState[at+8u]=digest.x;castState[at+9u]=digest.y;
 if(diff.quiet!=0u){return;}
 let castsNow=cur.has&&(roots.word&MOBILITY_SHADOWLESS)==0u;
 let castsWas=seen&&wasBoxed&&(wasWord&MOBILITY_SHADOWLESS)==0u;
 let movingNow=(roots.word&MOBILITY_MOVING)!=0u;
 let movingWas=(wasWord&MOBILITY_MOVING)!=0u;
 // The layer a box was and is cached in: the dynamic one for a placement that moves or deforms.
 let dynamicNow=cachedDynamic(roots.word);
 let dynamicWas=cachedDynamic(wasWord);
 // A placement that left casts nothing from now on, and its pages hold it where it was.
 if(castsWas&&!castsNow){emitBox(wasBox,dynamicWas,ALL_VIEWS,wasWord,roots.disableSq);return;}
 if(!castsNow){return;}
 if(!castsWas){emitBox(cur,dynamicNow,ALL_VIEWS,roots.word,roots.disableSq);return;}
 let pinned=(roots.word&MOBILITY_CACHE_STATIC)!=0u;
 // An arrival that was seen casting left and entered: both of its boxes are stale, a pinned placement's included.
 let moved=arrivedSince(r)||(!pinned&&(worldMoved||!sameBox(cur,wasBox)));
 if(moved){
  emitBox(wasBox,dynamicWas,ALL_VIEWS,wasWord,roots.disableSq);
  emitBox(cur,dynamicNow,ALL_VIEWS,roots.word,roots.disableSq);
 }else if(movingNow!=movingWas||((roots.word^wasWord)&MOBILITY_CAST_BITS)!=0u){
  // Where it stands: a cache state turned (it began to move, or settled and the static layer must
  // draw it), or its casting flags changed.
  emitBox(cur,dynamicNow&&dynamicWas,ALL_VIEWS,roots.word,roots.disableSq);
 }
}
/** The instances' cache state per view, one thread a placement (the reference's per-view bit arrays,
 *  one word a placement: bits 0..15 the views it was cached as dynamic in, bits 16..31 the views
 *  that tracked it, at \`castState\` word 10). Its deforming flag is its cached-as-dynamic state in
 *  every view; a tracked placement whose state turned has its transition bit set, and one that
 *  turned to dynamic has its dynamic layer staled in that view's maps, where it stands, the static
 *  layer kept. The state now and the transitions go to \`rootWords\`, after the mobility words, for
 *  the raster's casters to read (\`viewBits\`). */
@compute @workgroup_size(WORKGROUP_THREADS) fn ${CAST_INSTANCE_STATE_ENTRY}(@builtin(global_invocation_id) id:vec3u,@builtin(num_workgroups) n:vec3u){
 let r=flatIndex(id,n,WORKGROUP_THREADS);
 // The worlds are the diff's: named so that both entries bind the same group.
 let worlds=arrayLength(&rootWorlds);
 let base=vsmRootCount();
 let at=r*CAST_STATE_WORDS;
 if(r>=min(diff.roots,base)||worlds==0xffffffffu||at+CAST_STATE_WORDS>arrayLength(&castState)){return;}
 let roots=vsmRootWordsIn(r,base);
 let deforming=(roots.word&MOBILITY_DEFORMS)!=0u;
 // A placement that arrived starts with no cache state in any view, as an instance added to the scene does.
 let previous=select(castState[at+CAST_VIEWS_WORD],0u,arrivedSince(r));
 var dynamic=0u;
 var changed=0u;
 var invalidate=0u;
 for(var v=0u;v<diff.views;v++){
  let bit=1u<<v;
  let was=(previous&bit)!=0u;
  let tracked=(previous&(bit<<16u))!=0u;
  if(deforming){dynamic|=bit;}
  // Going from untracked is no state change: there was no state before.
  if(tracked&&deforming!=was){
   changed|=bit;
   // Only the transition to dynamic invalidates, the dynamic layer alone.
   if(deforming){invalidate|=bit;}
  }
 }
 let allViews=select(0xffffu,(1u<<diff.views)-1u,diff.views<16u);
 castState[at+CAST_VIEWS_WORD]=dynamic|(allViews<<16u);
 rootWords[${ROOT_SECTION.state}u*base+r]=dynamic|(changed<<16u);
 if(diff.quiet!=0u||invalidate==0u){return;}
 let cur=instanceBox(r);
 if(cur.has){emitBox(cur,true,invalidate,roots.word,roots.disableSq);}
}
`,
  [
    toF32,
    CAST_EMIT_WGSL,
    FLAT_INDEX_WGSL,
    WORKGROUP_THREADS_WGSL,
    UNBOUNDED_EXTENT_WGSL,
    ROOT_WORDS_WGSL,
    bitWord,
    bitIsSet,
  ],
)
