import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'
import { wgslF32 } from '../../../../../math/src/wgsl/number.ts'
import { SCREEN_MARCH_BASE_WGSL } from './screenMarchBase.ts'

/** The distance, in texels of the level it is taken at, past a cell boundary the walk puts a ray
 *  (`screenPlaneTime`), and the share of a tile's depth a ray is taken for above it before it has
 *  travelled (`screenTileDepth`). */
const REFERENCE_OFFSET = 0.005
const REFERENCE_TILE_FUDGE = 0.99
/** How far along the ray, as a share of its length, the fudge of the tile's depth fades away: a
 *  tenth of it. */
const REFERENCE_FUDGE_RUN = 10

/**
 * THE REFERENCE WALK OF THE PYRAMID (`screenMarchReference`): the closest depth of the opaque image
 * (the nearest layer built without the planes, `hizTrace` `'reference'`), each texel at its centre,
 * walked mip by mip from the first texel of the half-resolution level up and down again (stackless:
 * the mip moves one step an iteration, up when the ray passes above the tile, down when it does
 * not). `screenMarch` calls it for the settings' default.
 *
 * The ray is `o + d·t` like `screenMarchPlanes`'s, `t` from 0 to `end`; the walk's own time runs from
 * 0 to 1 over `d · end`. It steps out of the texel it starts in first, without a test, so that it
 * does not meet the surface it leaves. At each iteration it reads the closest depth of the tile
 * under the ray at the walk's mip, `REFERENCE_TILE_FUDGE` of it near the start (the fudge fades over
 * the first tenth of the ray); the ray above that depth is taken to the nearest of the tile's edge
 * and the plane of that depth, one mip up when it reached the tile's edge first, else one down;
 * not above it, it stays and goes one mip down. Below the first mip it is behind a surface: a hit
 * when it lies no further behind the tile's depth than the thickness (`screenBack`), else a miss.
 * A ray that runs out of iterations or leaves the screen meets nothing. A hit is the tile's depth,
 * flat: its plane has no slopes, and its pixel is the centre of the tile.
 *
 * Level `l` of the pyramid is the mip `l - 1` here: the first level holds the closest of 2 × 2
 * pixels, as the reference's half-resolution mip 0 does. A mip past the last reads the last.
 */
export const SCREEN_MARCH_REFERENCE_WGSL = (group: number, binding: number) =>
  wgslBlock(
    `SCREEN_MARCH_REFERENCE_WGSL(${group}, ${binding})`,
    [SCREEN_MARCH_BASE_WGSL(group, binding)],
    `const REFERENCE_OFFSET:f32=${wgslF32(REFERENCE_OFFSET)};
const REFERENCE_TILE_FUDGE:f32=${wgslF32(REFERENCE_TILE_FUDGE)};
const REFERENCE_FUDGE_RUN:f32=${wgslF32(REFERENCE_FUDGE_RUN)};
fn screenTileDepth(p:vec2f,mip:i32)->f32{
 let level=min(mip+1,hizLevelCount()-1);
 return hizCellNearest(vec2i(floor(p/exp2(f32(level)))),level);
}
fn screenPlaneTime(p:vec2f,start:vec2f,mip:i32,inv:vec2f,ahead:vec2<bool>)->f32{
 let texel=exp2(f32(mip+1));
 let offset=select(vec2f(-REFERENCE_OFFSET*texel),vec2f(REFERENCE_OFFSET*texel),ahead);
 let plane=(floor(p/texel)+select(vec2f(0.0),vec2f(1.0),ahead))*texel+offset;
 let times=(plane-start)*inv;
 return min(times.x,times.y);
}
fn screenMarchReference(o:vec3f,d:vec3f,end:f32,thickness:f32,slab:vec4f,cap:u32)->ScreenHit{
 let levels=hizLevelCount();
 let miss=ScreenHit(-1.0,vec3f(0.0),vec2f(0.0),false,0u);
 if(levels<2){return miss;}
 let steps=min(screenMarchBudget(d,end,levels),cap);
 let dir=d*end;
 let tiny=vec2f(1e-6);
 let ahead=dir.xy>=vec2f(0.0);
 let inv=1.0/select(dir.xy,select(-tiny,tiny,ahead),abs(dir.xy)<tiny);
 var time=screenPlaneTime(o.xy,o.xy,0,inv,ahead);
 var ray=select(o,o+dir*time,time<1.0);
 var mip=0;
 var k=0u;
 for(var j=0u;j<steps;j++){
  if(mip<0||time>=1.0){break;}
  let tile=screenTileDepth(ray.xy,mip)*mix(REFERENCE_TILE_FUDGE,1.0,saturate(time*REFERENCE_FUDGE_RUN));
  var zTime=1.0;
  if(dir.z<0.0){zTime=(tile-o.z)/dir.z;}
  let edge=min(screenPlaneTime(ray.xy,o.xy,mip,inv,ahead),zTime);
  let above=ray.z>tile;
  let skipped=above&&edge!=zTime;
  if(above){time=edge;}
  ray=o+dir*min(time,1.0);
  mip+=select(-1,1,skipped);
  k++;
 }
 if(mip>=0||time>=1.0){return ScreenHit(-1.0,vec3f(0.0),vec2f(0.0),false,k);}
 let tile=screenTileDepth(ray.xy,0);
 if(ray.z<screenBack(tile,thickness,slab)){return ScreenHit(-1.0,vec3f(0.0),vec2f(0.0),false,k);}
 let centre=(floor(ray.xy*0.5)+vec2f(0.5))*2.0;
 return ScreenHit(time*end,vec3f(tile,0.0,0.0),centre,hizFrontOver(vec2i(floor(ray.xy))),k);
}`,
  )
