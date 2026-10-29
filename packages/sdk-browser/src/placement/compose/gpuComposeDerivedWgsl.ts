/**
 * What the root boxes pass (`../roots/rootBoxesWgsl.ts`) and the transparent entries pass
 * (`../../blend/transparent/entryCornersWgsl.ts`) derive from a root's world, each the CPU formula's
 * to the word — the doubles it derives them in, rounded where it rounds them: the root's world box
 * and the eight corners of a transparent entry its occlusion test projects. The declarations the
 * program holds:
 *
 *   corners   array<u32>     `CORNER_VALUES` words an entry, its occlusion corners
 *   rootBoxes array<vec2u>   `ROOT_BOX_DOUBLES` a root, its world box, its stretch, then its ball
 *
 * An affine world — its last row `(0, 0, 0, 1)`, as every product of the poses a node tree makes
 * is — takes the corners' divide by `w` as the CPU does: it is 1.
 */
import { wgslDouble } from '../../../../math/src/wgsl/number.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { dAdd, dLess, dMul, dSub, splitDouble } from '../../../../math/src/wgsl/double.ts'
import { D_HALF } from '../../../../math/src/wgsl/doubleConstants.ts'
import { doubleAsSingle, fromF32 } from '../../../../math/src/wgsl/f32.ts'
import { affineAxis, dBoxAffine } from '../../../../math/src/wgsl/doubleAffine.ts'
import { dIsFinite } from '../../../../math/src/wgsl/doubleRound.ts'
import { dIsNan } from '../../../../math/src/wgsl/doubleWords.ts'
import { STRETCH_DOUBLE_WGSL } from '../gpuStretchWgsl.ts'
import { ROOT_BOX_DOUBLES, ROOT_LOCAL_DOUBLES } from '../roots/rootWorldSends.ts'

/** The eight corners of the box of bounds `lo` and `hi` at `world`, from word `out` of `corners`, as
 *  `pageCornersInto` derives them: corner `k` takes the maximum on `x` when bit 0 of `k` is set, on
 *  `y` for bit 1, on `z` for bit 2; each coordinate two words, the single rounding then its residue:
 *  a transparent entry's (`../../blend/transparent/entryCorners.ts`). */
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

/** Root `rank`'s words (`rootBoxes`, `ROOT_BOX_DOUBLES` a root): its world box, its local box
 *  (`rootInputs`) carried by `world`, zero when it has none, then the stretch of `world`
 *  (`maxStretchOf`), then its ball, zero when it has no local box: the centre of the local box
 *  carried by `world` (three doubles) and the radius, a single widened — the half extent of the
 *  local box scaled along each axis by the length of that axis of `world`, its length: what a map
 *  judges the whole object by —, then its oriented box: the three half axes (each column of `world`'s
 *  linear part times the local half extent along it, singles), what a shadow change stales the pages
 *  of. The stretch returned. */
export const WORLD_BOX_WGSL = wgslBlock(
  'WORLD_BOX_WGSL',
  [
    CARRIED_BOX_WGSL,
    STRETCH_DOUBLE_WGSL,
    affineAxis,
    dAdd,
    dSub,
    dMul,
    D_HALF,
    doubleAsSingle,
    fromF32,
  ],
  `
/** The f32 length of column \`c\` of \`world\`'s linear part. */
fn axisScale(world:array<vec2u,16>,c:u32)->f32{
 return length(vec3f(doubleAsSingle(world[4u*c]),doubleAsSingle(world[4u*c+1u]),doubleAsSingle(world[4u*c+2u])));
}
fn composeRoot(rank:u32,world:array<vec2u,16>)->vec2u{
 let at=rank*${ROOT_LOCAL_DOUBLES}u;
 let o=rank*${ROOT_BOX_DOUBLES}u;
 if(rootInputs[at+${ROOT_LOCAL_DOUBLES - 1}u].x!=0u){
  var lo:array<vec2u,3>;
  var hi:array<vec2u,3>;
  for(var a=0u;a<3u;a++){lo[a]=rootInputs[at+a];hi[a]=rootInputs[at+3u+a];}
  let box=carriedBox(world,lo,hi);
  for(var k=0u;k<6u;k++){rootBoxes[o+k]=box[k];}
  var mid:array<vec2u,3>;
  var halfSize=vec3f(0.0);
  for(var a=0u;a<3u;a++){
   mid[a]=dMul(dAdd(lo[a],hi[a]),D_HALF);
   halfSize[a]=doubleAsSingle(dMul(dSub(hi[a],lo[a]),D_HALF));
  }
  for(var a=0u;a<3u;a++){rootBoxes[o+7u+a]=affineAxis(world,a,mid[0],mid[1],mid[2]);}
  rootBoxes[o+10u]=fromF32(bitcast<u32>(length(halfSize*vec3f(axisScale(world,0u),axisScale(world,1u),axisScale(world,2u)))));
  // The oriented box: the half axes, the local half extent along each column of \`world\`, nine singles
  // in the five doubles after the ball.
  var axes:array<u32,10>;
  for(var c=0u;c<3u;c++){
   let axisHalf=halfSize[c]*vec3f(doubleAsSingle(world[4u*c]),doubleAsSingle(world[4u*c+1u]),doubleAsSingle(world[4u*c+2u]));
   for(var a=0u;a<3u;a++){axes[3u*c+a]=bitcast<u32>(axisHalf[a]);}
  }
  axes[9]=0u;
  for(var k=0u;k<5u;k++){rootBoxes[o+11u+k]=vec2u(axes[2u*k],axes[2u*k+1u]);}
 }else{
  for(var k=0u;k<6u;k++){rootBoxes[o+k]=vec2u(0u,0u);}
  for(var k=7u;k<${ROOT_BOX_DOUBLES}u;k++){rootBoxes[o+k]=vec2u(0u,0u);}
 }
 let stretch=maxStretchOf(world);
 rootBoxes[o+6u]=stretch;
 return stretch;
}`,
)
