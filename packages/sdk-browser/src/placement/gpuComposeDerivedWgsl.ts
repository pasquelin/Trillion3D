/**
 * What the rows pass (`rowWordsWgsl.ts`) and the root boxes pass (`rootBoxesWgsl.ts`) derive
 * from a root's world besides the words of the row itself, each the CPU formula's to the word — the
 * doubles it derives them in, rounded where it rounds them: the root's world box, the eight corners
 * of a row the Hi-Z test projects, and the detail words the shadows' levels are judged by. They read
 * what a world does not change from a row's inputs (`rowInputPack.ts`), twenty-four doubles a row,
 * the declarations the program holds:
 *
 *   inputs    array<vec2u>   a row's inputs, `ROW_INPUT_DOUBLES` doubles each
 *   corners   array<u32>     `CORNER_VALUES` words a row, the Hi-Z corners
 *   lods      array<u32>     `ROW_LOD_FLOATS` words a row, the shadow detail
 *   rootBoxes array<vec2u>   six doubles a root, its world box
 *
 * An affine world — its last row `(0, 0, 0, 1)`, as every product of the poses a node tree makes
 * is — takes the corners' divide by `w` as the CPU does: it is 1.
 */
import { wgslDouble } from '../../../math/src/wgsl/number.ts'
import { wgslBlock } from '../../../math/src/wgsl/decl.ts'
import { dAdd, dLess, dMul, dSqrt, dSub, splitDouble } from '../../../math/src/wgsl/double.ts'
import { affineAxis, dBoxAffine } from '../../../math/src/wgsl/doubleAffine.ts'
import { dIsFinite } from '../../../math/src/wgsl/doubleRound.ts'
import { dIsNan } from '../../../math/src/wgsl/doubleWords.ts'
import { FINITE_SENTINEL } from '../../../math/src/wgsl/constants.ts'
import { STRETCH_DOUBLE_WGSL } from './gpuStretchWgsl.ts'
import { CORNER_VALUES } from '../gpu/partition/contract.ts'
import { LOD_BIT, LOD_INPUT, ROW_LOD_FLOATS } from '../webgpu/shadow/rowLodWords.ts'
import { INPUT_LOD, ROW_INPUT_DOUBLES } from './rowInputPack.ts'

/** The eight corners of the box of bounds `lo` and `hi` at `world`, from word `out` of `corners`, as
 *  `pageCornersInto` derives them: corner `k` takes the maximum on `x` when bit 0 of `k` is set, on
 *  `y` for bit 1, on `z` for bit 2; each coordinate two words, the single rounding then its residue.
 *  A row's (`composeCorners`) and a transparent entry's (`../webgpu/transparent/entryCorners.ts`). */
export const BOX_CORNERS_WGSL = wgslBlock(
  'BOX_CORNERS_WGSL',
  [splitDouble, affineAxis],
  `
fn writeCorners(out:u32,world:array<vec2u,16>,lo:array<vec2u,3>,hi:array<vec2u,3>){
 var p:array<vec2u,3>;
 for(var k=0u;k<8u;k++){
  for(var axis=0u;axis<3u;axis++){
   p[axis]=lo[axis];
   if(((k>>axis)&1u)!=0u){p[axis]=hi[axis];}
  }
  for(var axis=0u;axis<3u;axis++){
   let s=splitDouble(affineAxis(world,axis,p[0],p[1],p[2]));
   corners[out+k*6u+axis]=s.x;
   corners[out+k*6u+3u+axis]=s.y;
  }
 }
}`,
)

/** The eight corners of row `row`'s grown box (its inputs' from double 6) at `world`. */
export const CORNERS_WGSL = wgslBlock(
  'CORNERS_WGSL',
  [BOX_CORNERS_WGSL],
  `
fn composeCorners(row:u32,world:array<vec2u,16>){
 let at=row*${ROW_INPUT_DOUBLES}u;
 var lo:array<vec2u,3>;
 var hi:array<vec2u,3>;
 for(var axis=0u;axis<3u;axis++){lo[axis]=inputs[at+6u+axis];hi[axis]=inputs[at+9u+axis];}
 writeCorners(row*${CORNER_VALUES}u,world,lo,hi);
}`,
)

/** The box of bounds `lo` and `hi` carried by the affine `world` as `boxTransform` carries it
 *  (`dBoxAffine`): six doubles, an empty box left as it is; a bound not finite takes the CPU's
 *  projective path (`unitW`), where a corner's `w` is `0·∞`: every bound NaN. */
export const CARRIED_BOX_WGSL = wgslBlock(
  'CARRIED_BOX_WGSL',
  [dBoxAffine, dLess, dIsFinite, dIsNan],
  `
fn carriedBox(world:array<vec2u,16>,lo:array<vec2u,3>,hi:array<vec2u,3>)->array<vec2u,6>{
 var box:array<vec2u,6>;
 for(var a=0u;a<3u;a++){box[a]=lo[a];box[3u+a]=hi[a];}
 // Empty as the CPU finds it (\`boundsAreEmpty\`): an axis whose high lies under its low; a NaN
 // bound compares false there, so it never makes a box empty.
 for(var a=0u;a<3u;a++){
  if(!dIsNan(lo[a])&&!dIsNan(hi[a])&&dLess(hi[a],lo[a])){return box;}
 }
 for(var k=0u;k<6u;k++){
  if(!dIsFinite(box[k])){
   for(var j=0u;j<6u;j++){box[j]=${wgslDouble(NaN)};}
   return box;
  }
 }
 return dBoxAffine(box,world);
}`,
)

/** The world box of root `rank`: its local box (`rootInputs`, six doubles from `at`) carried by
 *  `world`. */
export const WORLD_BOX_WGSL = wgslBlock(
  'WORLD_BOX_WGSL',
  [CARRIED_BOX_WGSL],
  `
fn composeBox(rank:u32,at:u32,world:array<vec2u,16>){
 var lo:array<vec2u,3>;
 var hi:array<vec2u,3>;
 for(var a=0u;a<3u;a++){lo[a]=rootInputs[at+a];hi[a]=rootInputs[at+3u+a];}
 let box=carriedBox(world,lo,hi);
 for(var k=0u;k<6u;k++){rootBoxes[rank*6u+k]=box[k];}
}`,
)

/** Row `row`'s detail words at `world`: the errors and their centres by the stretch of
 *  the world, the radii, the radius of the root's world box, the residency folded in. */
export const LOD_WGSL = wgslBlock(
  'LOD_WGSL',
  [splitDouble, affineAxis, STRETCH_DOUBLE_WGSL, dSqrt, dMul, dAdd, dSub, FINITE_SENTINEL],
  `
fn lodCentre(o:u32,at:u32,world:array<vec2u,16>,src:u32,low:u32){
 for(var axis=0u;axis<3u;axis++){
  let s=splitDouble(affineAxis(world,axis,inputs[at+src],inputs[at+src+1u],inputs[at+src+2u]));
  lods[o+low-8u+axis]=s.x;
  lods[o+low+axis]=s.y;
 }
}
fn composeLod(row:u32,rank:u32,world:array<vec2u,16>){
 let at=row*${ROW_INPUT_DOUBLES}u+${INPUT_LOD}u;
 let o=row*${ROW_LOD_FLOATS}u;
 for(var k=0u;k<${ROW_LOD_FLOATS}u;k++){lods[o+k]=0u;}
 lods[o+7u]=bitcast<u32>(FINITE_SENTINEL);
 let flags=inputs[at+${LOD_INPUT.flags}u].x;
 if((flags&${LOD_BIT.hasBox}u)!=0u){
  let a=rootBoxes[rank*6u];let b=rootBoxes[rank*6u+1u];let c=rootBoxes[rank*6u+2u];
  let dx=dSub(rootBoxes[rank*6u+3u],a);
  let dy=dSub(rootBoxes[rank*6u+4u],b);
  let dz=dSub(rootBoxes[rank*6u+5u],c);
  let s=dAdd(dAdd(dMul(dx,dx),dMul(dy,dy)),dMul(dz,dz));
  lods[o+18u]=toF32(dMul(dSqrt(s),${wgslDouble(0.5)}));
 }
 if((flags&${LOD_BIT.has}u)==0u){return;}
 let scale=maxStretchOf(world);
 if((flags&${LOD_BIT.childReady}u)!=0u){lods[o+3u]=toF32(dMul(inputs[at+${LOD_INPUT.own}u],scale));}
 lodCentre(o,at,world,${LOD_INPUT.sphere}u,8u);
 lods[o+16u]=toF32(dMul(inputs[at+${LOD_INPUT.sphere + 3}u],scale));
 if((flags&${LOD_BIT.ready}u)==0u){lods[o+7u]=0u;return;}
 if((flags&${LOD_BIT.hasParent}u)!=0u){
  lodCentre(o+4u,at,world,${LOD_INPUT.parentSphere}u,8u);
  lods[o+7u]=toF32(dMul(inputs[at+${LOD_INPUT.parent}u],scale));
  lods[o+17u]=toF32(dMul(inputs[at+${LOD_INPUT.parentSphere + 3}u],scale));
 }
}`,
)
