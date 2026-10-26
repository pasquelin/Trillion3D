import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { ceilDivWgsl } from '../../../../math/src/wgsl/integer.ts'
import {
  SSS_ARGS,
  SSS_ARGUMENTS,
  SSS_DISPATCH_WRAP,
  SSS_TEXTURES,
  SSS_TILES,
  SSS_TILE_TYPE as T,
} from './layout.ts'
import { SSS_COMMON_WGSL } from './commonWgsl.ts'

/**
 * WHAT THE COMPUTE KERNELS SHARE BEYOND THE UNIFORM: the textures of group 1, the lists of group 2 and the shape of the pass as
 * constants (`sssShapeHeader`). The profile ids' format is the device's (`idsFormat`).
 */
export const sssComputeBindings = (idsFormat: string) =>
  wgslBlock(
    `SSS_COMPUTE_BINDINGS(${idsFormat})`,
    [SSS_COMMON_WGSL],
    `@group(1) @binding(${SSS_TEXTURES.a}) var texA:texture_2d<f32>;
@group(1) @binding(${SSS_TEXTURES.b}) var texB:texture_2d<f32>;
@group(1) @binding(${SSS_TEXTURES.c}) var texC:texture_2d<f32>;
@group(1) @binding(${SSS_TEXTURES.ids}) var texIds:texture_2d<u32>;
@group(1) @binding(${SSS_TEXTURES.out}) var outA:texture_storage_2d<rgba16float,write>;
@group(1) @binding(${SSS_TEXTURES.history}) var outHistory:texture_storage_2d<rgba16float,write>;
@group(1) @binding(${SSS_TEXTURES.idsOut}) var outIds:texture_storage_2d<${idsFormat},write>;
${SSS_TILE_BINDINGS}
/** The tile a workgroup works on, of the list of its type: the group's place on the wrapped dispatch. */
fn sssTileIndex(g:vec3u)->u32{return g.y*${SSS_DISPATCH_WRAP}u+g.x;}
fn sssTileAt(kind:u32,index:u32)->vec2u{return sssTileOf(lists[kind*sssMaxTiles()+index]);}`,
  )

const SSS_TILE_BINDINGS = `@group(2) @binding(${SSS_TILES.counts}) var<storage,read_write> counts:array<atomic<u32>,5>;
@group(2) @binding(${SSS_TILES.lists}) var<storage,read_write> lists:array<u32>;
@group(2) @binding(${SSS_TILES.masks}) var<storage,read_write> masks:array<atomic<u32>>;
fn sssMaxTiles()->u32{return view.tiles.x*view.tiles.y;}
fn sssCount(kind:u32)->u32{return min(atomicLoad(&counts[kind]),sssMaxTiles());}`

/** The half-resolution pixels' four neighbours' coordinates (the corners of the pixel, a half texel of the image's apart, held in the
 *  drawn view) and the pixels they read. */
export const NEIGHBOURS_WGSL = wgslBlock(
  'SSS_NEIGHBOURS_WGSL',
  [SSS_COMMON_WGSL],
  `fn sssCorner(buv:vec2f,i:u32)->vec2f{
 let inv=vec2f(1.0)/view.scene.zw;
 var o=vec2f(-0.5,0.5);
 if(i==1u){o=vec2f(0.5,0.5);}
 if(i==2u){o=vec2f(0.5,-0.5);}
 if(i==3u){o=vec2f(-0.5,-0.5);}
 return min(buv+o*inv,(view.scene.xy-vec2f(0.5))*inv);
}`,
)

/** Whether the profile pixel at `uv` scatters beyond its own footprint: the share of its scattering inside the pixel is under the
 *  threshold (`sssEffective`). */
const EFFECTIVE_WGSL = wgslBlock(
  'SSS_EFFECTIVE_WGSL',
  [SSS_COMMON_WGSL],
  `fn sssEffective(uv:vec2f)->bool{
 let p=sssPixelAtUv(uv);
 if(!sssIsProfile(p)){return false;}
 let depth=sssDepthAt(p);
 if(depth<=0.0){return false;}
 let b=sssBurley(sssProfileAt(p),sssOpacityAt(p));
 let radius=sssCenterRadius(sssBurleyScale(b.unit,depth));
 return sssCenterCdf(b,radius)<view.tune.x;
}`,
)

/**
 * THE TILE CLASSIFICATION: one kernel marks the tiles that hold a profile pixel (`sssMark`, a bit a tile, in the three masks: all,
 * those whose profile pixels scatter inside their own footprint alone, the others), one builds each mask's list in z-order, 64 tiles a
 * group (`sssLists`), so that the tiles of the lists are as near each other on the screen as they were. A tile of the others is
 * dispatched by the setup (`sssArgsTiles`).
 */
export const SSS_TILE_KERNELS_WGSL = wgslBlock(
  'SSS_TILE_KERNELS_WGSL',
  [NEIGHBOURS_WGSL, EFFECTIVE_WGSL, ceilDivWgsl],
  `var<workgroup> wgSss:atomic<u32>;
var<workgroup> wgPass:atomic<u32>;
fn sssMaskWords()->u32{return ceilDiv(sssMaxTiles(),32u);}
@compute @workgroup_size(8,8)
fn sssMark(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_id) l:vec3u,@builtin(local_invocation_index) gi:u32){
 if(gi==0u){atomicStore(&wgSss,0u);atomicStore(&wgPass,0u);}
 workgroupBarrier();
 let pos=g.xy*8u+l.xy;
 let buv=(vec2f(pos)+vec2f(0.5))/view.sub.zw;
 var has=false;
 var inside=false;
 if(SSS_HALF){
  var sum=0u;
  for(var i=0u;i<4u;i++){sum+=select(0u,1u,sssIsProfile(sssPixelAtUv(sssCorner(buv,i))));}
  has=sum>0u;
 }else{
  has=sssIsProfile(sssPixelAtUv(buv));
 }
 has=has&&all(vec2f(pos)<view.sub.xy);
 if(has){
  if(SSS_HALF){
   var effective=false;
   for(var i=0u;i<4u;i++){effective=effective||sssEffective(sssCorner(buv,i));}
   inside=!effective;
  }else{inside=!sssEffective(buv);}
 }
 if(has){atomicAdd(&wgSss,1u);}
 if(inside){atomicAdd(&wgPass,1u);}
 workgroupBarrier();
 if(gi==0u){
  let s=atomicLoad(&wgSss);
  let p=atomicLoad(&wgPass);
  let index=view.tiles.x*g.y+g.x;
  let bit=1u<<(index%32u);
  let words=sssMaskWords();
  if(s>0u){atomicOr(&masks[index/32u],bit);}
  if(s>0u&&p==s){atomicOr(&masks[words+index/32u],bit);}
  if(s>0u&&p!=s){atomicOr(&masks[2u*words+index/32u],bit);}
 }
}
var<workgroup> wgN:u32;
var<workgroup> wgOffset:u32;
var<workgroup> wgTiles:array<u32,64>;
fn sssZOrder(i:u32)->vec2u{
 var c=vec2u(0u);
 for(var k=0u;k<3u;k++){c.x|=((i>>(2u*k))&1u)<<k;c.y|=((i>>(2u*k+1u))&1u)<<k;}
 return c;
}
@compute @workgroup_size(8,8)
fn sssLists(@builtin(workgroup_id) g:vec3u,@builtin(local_invocation_index) gi:u32){
 let words=sssMaskWords();
 var types=array<u32,3>(${T.all}u,${T.passthrough}u,${T.nonPassthrough}u);
 for(var t=0u;t<3u;t++){
  if(gi==0u){
   wgN=0u;
   for(var i=0u;i<64u;i++){
    let tile=g.xy*8u+sssZOrder(i);
    if(tile.x<view.tiles.x&&tile.y<view.tiles.y){
     let index=view.tiles.x*tile.y+tile.x;
     let used=(atomicLoad(&masks[t*words+index/32u])&(1u<<(index%32u)))!=0u;
     if(used){wgTiles[wgN]=sssTileWord(tile);wgN=wgN+1u;}
    }
   }
   if(wgN>0u){wgOffset=atomicAdd(&counts[types[t]],wgN);}
  }
  workgroupBarrier();
  if(gi<wgN&&wgOffset+gi<sssMaxTiles()){lists[types[t]*sssMaxTiles()+wgOffset+gi]=wgTiles[gi];}
  workgroupBarrier();
 }
}`,
)

/**
 * THE ARGUMENTS OF THE INDIRECT DISPATCHES AND DRAWS, from the counts of the lists: a list's dispatch is one group a tile on a grid that
 * wraps at 65535 groups an axis (the groups past the count do nothing), a draw is six vertices an instance a tile. `sssArgsTiles`
 * follows the classification (the three lists it builds, the clear of the scattering's last target when the pass has no other
 * scattering and, in half resolution, of its second); `sssArgsScatter` follows the setup (the two lists it builds, the mip chain's
 * dispatches — made only from `scatter.w` tiles of the sampled scattering — and the clear of the first target when a tile of the
 * separable scattering reads it). The arguments live in group 3, a buffer the dispatches read being bound to none of them.
 */
export const SSS_ARGS_WGSL = wgslBlock(
  'SSS_ARGS_WGSL',
  [SSS_COMMON_WGSL, ceilDivWgsl],
  `${SSS_TILE_BINDINGS}
@group(3) @binding(${SSS_ARGUMENTS.dispatch}) var<storage,read_write> dispatchArgs:array<u32>;
@group(3) @binding(${SSS_ARGUMENTS.draw}) var<storage,read_write> drawArgs:array<u32>;
fn sssWriteDispatch(slot:u32,x:u32,y:u32){
 dispatchArgs[slot*3u]=x;dispatchArgs[slot*3u+1u]=y;dispatchArgs[slot*3u+2u]=1u;
}
fn sssWriteTiles(slot:u32,n:u32){
 sssWriteDispatch(slot,select(0u,min(n,${SSS_DISPATCH_WRAP}u),n>0u),select(0u,(n+${SSS_DISPATCH_WRAP - 1}u)/${SSS_DISPATCH_WRAP}u,n>0u));
}
fn sssWriteArea(slot:u32,on:bool,size:vec2u){
 sssWriteDispatch(slot,select(0u,ceilDiv(size.x,8u),on),select(0u,ceilDiv(size.y,8u),on));
}
@compute @workgroup_size(1)
fn sssArgsTiles(){
 for(var t=${T.passthrough}u;t<=${T.all}u;t++){
  let n=sssCount(t);
  sssWriteTiles(t,n);
  drawArgs[t*4u]=6u;drawArgs[t*4u+1u]=n;drawArgs[t*4u+2u]=0u;drawArgs[t*4u+3u]=0u;
 }
 let size=vec2u(view.sub.zw);
 sssWriteArea(${SSS_ARGS.clearPassTwo}u,SSS_HALF&&sssCount(${T.all}u)>0u,size);
 sssWriteArea(${SSS_ARGS.clearPassOne}u,SSS_FORCE_SEPARABLE&&sssCount(${T.nonPassthrough}u)>0u,size);
}
@compute @workgroup_size(1)
fn sssArgsScatter(){
 sssWriteTiles(${T.sampled}u,sssCount(${T.sampled}u));
 sssWriteTiles(${T.separable}u,sssCount(${T.separable}u));
 let size=vec2u(view.sub.zw);
 sssWriteArea(${SSS_ARGS.clearPassOne}u,sssCount(${T.separable}u)>0u,size);
 let mips=sssCount(${T.sampled}u)>=u32(view.scatter.w);
 for(var m=1u;m<${SSS_ARGS.entries - SSS_ARGS.mip + 1}u;m++){
  sssWriteArea(${SSS_ARGS.mip}u+m-1u,mips&&m<view.tiles.z,max(size>>vec2u(m),vec2u(1u)));
 }
}`,
)

/** The clear of a scattering target to zero over a rectangle (`sssClear`), and the mip chain's level (`sssMip`): a texel of the
 *  next level is read from the one before through the bilinear weights of its centre, the texels outside the level zero. */
export const SSS_IMAGE_KERNELS_WGSL = wgslBlock(
  'SSS_IMAGE_KERNELS_WGSL',
  [SSS_COMMON_WGSL],
  `@compute @workgroup_size(8,8)
fn sssClear(@builtin(global_invocation_id) id:vec3u){
 if(all(id.xy<textureDimensions(outA))){textureStore(outA,id.xy,vec4f(0.0));}
}
fn sssMipTexel(p:vec2i,size:vec2i)->vec4f{
 if(any(p<vec2i(0))||any(p>=size)){return vec4f(0.0);}
 return textureLoad(texA,p,0);
}
@compute @workgroup_size(8,8)
fn sssMip(@builtin(global_invocation_id) id:vec3u){
 let dest=vec2i(textureDimensions(outA));
 if(any(vec2i(id.xy)>=dest)){return;}
 let src=vec2i(textureDimensions(texA));
 let q=(vec2f(id.xy)+vec2f(0.5))/vec2f(dest)*vec2f(src)-vec2f(0.5);
 let f=floor(q);
 let w=q-f;
 let b=vec2i(f);
 let top=mix(sssMipTexel(b,src),sssMipTexel(b+vec2i(1,0),src),w.x);
 let low=mix(sssMipTexel(b+vec2i(0,1),src),sssMipTexel(b+vec2i(1,1),src),w.x);
 textureStore(outA,id.xy,mix(top,low,w.y));
}`,
)
