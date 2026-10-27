/**
 * THE OCCLUSION PYRAMID'S BUILD: the pages drawn since the
 * last build selected, then each one's pyramid built from the pool, its texels' farthest depth
 * (reversed Z: the least) level after level.
 *
 * - `vsmSelectPyramidPages`, a thread a pool page:
 *   its raster marks folded into its words and cleared (`pmFoldRasterMarks`), then a page held by a
 *   map, not unseen this frame, whose static layer was drawn — or its dynamic layer, where its map
 *   is redrawn whole (the pyramid has one layer: no dynamic one of its own) — or every held page with `fullUpdate`
 *   (`shadowOcclusionFullUpdate`), listed: 16 groups of the build, one group of the top build; with
 *   the dynamic casters' layer, a page whose dynamic layer was drawn is listed too.
 * - `vsmBuildPyramid`, 16 groups a listed page, 16x16 threads a 32x32-texel tile: a thread the 2x2 pool texels at its place
 *   (`vsmReductionPosition`), read from the static slice — the pool's slice 0 for a page whose map is
 *   redrawn whole —, their least depth at level 0, then levels 1 to 3 by halving the tile in
 *   workgroup memory, each the least of a bank of four; with a layer for the dynamic casters
 *   (`hzbStaticLayer` above 0) the static slice builds that layer, and the dynamic slice's depths
 *   merged with the static's (the greater) build the first.
 * - `vsmBuildPyramidTop`, a group a listed page:
 *   levels 4 to 6 from level 3 (8x8 texels a page): 4x4 threads read 2x2 texels each, then 2x2
 *   threads, then one; once for each layer.
 *
 * The reference's tile kernel writes levels 0 to 4 and its top kernel levels 5 and 6 from level 4. A
 * device that grants five storage textures a stage (`pyramidTileLevels`) builds them so. Otherwise
 * the tile kernel stops at level 3: a WebGPU stage binds four storage textures by default and a
 * level is one storage view; the top kernel takes level 4 from level 3, the same least of the same
 * 2x2 texels.
 */
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { wgslBlock } from '../../../../../../math/src/wgsl/decl.ts'
import { VSM_CONSTANTS_WGSL } from '../constants.ts'
import { VSM_PAGE_ADDRESS_WGSL } from '../pageTableWgsl.ts'
import { TILE_WGSL, VSM_FOLD_RASTER_MARKS_WGSL } from '../physicalPagesWgsl.ts'
import { type VsmBindingSpec, vsmBindingsWgsl } from '../resources.ts'
import type { VsmLayout } from '../layout.ts'

/** Levels the pyramid holds: 0 to 6. */
const PYRAMID_LEVELS = 7
/** Levels the tile kernel writes on a device that grants four storage textures a stage: 0 to 3, one
 *  storage view each. */
const PYRAMID_TILE_LEVELS = 4
/** And on a device that grants five: 0 to 4. */
const PYRAMID_TILE_LEVELS_FIVE = 5

/** The levels the tile kernel writes on `device`: 0 to 4 where it grants five storage textures a
 *  stage, else 0 to 3. */
export const pyramidTileLevels = (device: Pick<GPUDevice, 'limits'>) =>
  device.limits.maxStorageTexturesPerShaderStage >= PYRAMID_TILE_LEVELS_FIVE
    ? PYRAMID_TILE_LEVELS_FIVE
    : PYRAMID_TILE_LEVELS

/** The levels the top kernel writes from the last of the tile kernel's `tileLevels`: the rest. */
export const pyramidTopLevels = (tileLevels: number) => PYRAMID_LEVELS - tileLevels

/** Group 0 of each kernel (the VSM resources). */
export const PYRAMID_SELECT_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'poolPageInfo', binding: 1, access: 'read_write' },
  { resource: 'rasterMarks', binding: 2, access: 'read_write' },
]
export const PYRAMID_BUILD_SPECS: readonly VsmBindingSpec[] = [
  { resource: 'uniforms', binding: 0 },
  { resource: 'poolPageInfo', binding: 1 },
  { resource: 'pagePool', binding: 2 },
]
export const PYRAMID_TOP_SPECS: readonly VsmBindingSpec[] = [{ resource: 'uniforms', binding: 0 }]

/** The place of a thread in a 16x16 tile of 2x2 texels: the bits of
 *  its index dealt to x and y so that each halving reads banks of four. */
const REDUCTION_POSITION_WGSL = wgslBlock(
  'REDUCTION_POSITION_WGSL',
  [],
  `
fn vsmSignedShift(x:u32,shift:i32)->u32{
 if(shift>0){return x<<u32(shift);}
 if(shift<0){return x>>u32(-shift);}
 return x;
}
fn vsmReductionPosition(lane:u32)->vec2u{
 var p=vec2u(0u);
 for(var i=0u;i<4u;i++){
  let bit=3u-i;
  let mask=1u<<bit;
  p.x|=mask&vsmSignedShift(lane,i32(bit)-i32(2u*i));
  p.y|=mask&vsmSignedShift(lane,i32(bit)-i32(2u*i+1u));
 }
 return p;
}`,
)

/** The selection: group 1 = 0 parameters (uniform: `fullUpdate`), 1 the listed pages (rw), 2 the
 *  two dispatches' arguments (rw atomic, (16, pages, 1) then (pages, 1, 1)). */
export const vsmSelectPyramidWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
struct VsmPyramidParams{fullUpdate:u32,}
@group(1) @binding(0) var<uniform> pyramidParams:VsmPyramidParams;
@group(1) @binding(1) var<storage,read_write> pyramidPages:array<u32>;
@group(1) @binding(2) var<storage,read_write> pyramidArgs:array<atomic<u32>>;
/** Whether a page's words ask its pyramid built again: held by a map, not unseen, its static layer
 *  drawn, or its dynamic layer where its map is redrawn whole or the pyramid has a layer of the
 *  dynamic casters. */
fn vsmPyramidRebuilds(flags:u32)->bool{
 if((flags&VSM_PAGE_WANTED)==0u){return false;}
 let staticDrawn=(flags&VSM_META_STATIC_DRAWN)!=0u;
 let dynamicDrawn=(flags&VSM_META_DYNAMIC_DRAWN)!=0u;
 let unseen=(flags&VSM_META_UNSEEN)!=0u;
 let viewUncached=(flags&VSM_META_VIEW_UNCACHED)!=0u;
 let separate=vsm.hzbStaticLayer!=0u;
 return (staticDrawn||((viewUncached||separate)&&dynamicDrawn))&&!unseen;
}
@compute @workgroup_size(VSM_GROUP_WIDTH)
fn vsmSelectPyramidPages(@builtin(global_invocation_id) id:vec3u){
 let poolIndex=id.x;
 if(poolIndex>=vsm.poolPages){return;}
 let flags=pmFoldRasterMarks(poolIndex);
 if((flags&VSM_PAGE_WANTED)==0u){return;}
 if(pyramidParams.fullUpdate!=0u||vsmPyramidRebuilds(flags)){
  // 16 tile groups a page (the group's y), one top group (the second dispatch's x).
  pyramidPages[atomicAdd(&pyramidArgs[1],1u)]=poolIndex;
  atomicAdd(&pyramidArgs[4],1u);
 }
}
`,
    [
      VSM_CONSTANTS_WGSL,
      vsmBindingsWgsl(0, PYRAMID_SELECT_SPECS, layout),
      VSM_FOLD_RASTER_MARKS_WGSL,
    ],
  )

const levelStores = (first: number, count: number, binding: number) =>
  Array.from(
    { length: count },
    (_, k) =>
      `@group(1) @binding(${binding + k}) var pyramidLevel${first + k}:texture_storage_2d_array<r32float,write>;`,
  ).join('\n')

const pyramidTileHelpersText = (
  tileLevels: number,
) => /* wgsl */ `@group(1) @binding(0) var<storage,read> pyramidPages:array<u32>;
${levelStores(0, tileLevels, 1)}
var<workgroup> pyramidShared:array<f32,256>;
/** A thread's 2x2 pool texels: their first texel and the slice they are read in, and whether its
 *  page's map is redrawn whole (one build, from slice 0). */
struct VsmPyramidTile{texel:vec2u,slice:u32,uncached:bool,}
/** The 2x2 depths at a pool texel, (-,+), (+,+), (+,-), (-,-), each word read as its float. */
fn vsmPyramidGather(texel:vec2u,slice:u32)->vec4f{
 return bitcast<vec4f>(vec4u(
  vsmPoolLoad(vec2u(texel.x,texel.y+1u),slice),
  vsmPoolLoad(texel+vec2u(1u),slice),
  vsmPoolLoad(vec2u(texel.x+1u,texel.y),slice),
  vsmPoolLoad(texel,slice)));
}
/** Thread \`lane\` of tile group \`groupIndex\`: its texels, in the static slice unless its page's map
 *  is redrawn whole (that page's casters all draw into slice 0). */
fn vsmPyramidTileOf(groupIndex:u32,lane:u32)->VsmPyramidTile{
 let tile=pmTileOf(groupIndex,pyramidPages[groupIndex>>PM_LOG2_TILES]);
 let viewUncached=(vsmPoolPageInfo[tile.poolPageIndex].flags&VSM_META_VIEW_UNCACHED)!=0u;
 return VsmPyramidTile(pmTileOffset(tile)+(vsmReductionPosition(lane)<<vec2u(1u)),select(vsm.staticSlice,0u,viewUncached),viewUncached);
}
/** Level 0 of layer \`layer\`: the least of the depths \`z\` (the thread's 2x2). */
fn vsmPyramidFirst(t:VsmPyramidTile,lane:u32,layer:u32,z:vec4f){
 let least=min(min(z.x,z.y),min(z.z,z.w));
 pyramidShared[lane]=least;
 textureStore(pyramidLevel0,t.texel>>vec2u(1u),layer,vec4f(least));
}
/** Level \`level\` (1 to the tile kernel's last) of layer \`layer\`: the threads of its bank, each the least of its four. */
fn vsmPyramidHalve(level:u32,t:VsmPyramidTile,lane:u32,layer:u32){
 let side=16u>>level;
 let bank=side*side;
 if(lane>=bank){return;}
 let least=min(min(pyramidShared[lane],pyramidShared[lane+bank]),min(pyramidShared[lane+2u*bank],pyramidShared[lane+3u*bank]));
 let at=t.texel>>vec2u(level+1u);
 switch(level){
${Array.from(
  { length: tileLevels - 2 },
  (_, k) => `  case ${k + 1}u:{textureStore(pyramidLevel${k + 1},at,layer,vec4f(least));}`,
).join('\n')}
  default:{textureStore(pyramidLevel${tileLevels - 1},at,layer,vec4f(least));}
 }
 pyramidShared[lane]=least;
}`

const pyramidTileKernelText = (tileLevels: number) => /* wgsl */ `
@compute @workgroup_size(16,16)
fn vsmBuildPyramid(@builtin(local_invocation_index) lane:u32,@builtin(workgroup_id) wid:vec3u){
 let t=vsmPyramidTileOf(pmGroupIndex(wid),lane);
 // The static build — the only one for a page redrawn whole, from its slice 0 into the first layer.
 let layer=select(vsm.hzbStaticLayer,0u,t.uncached);
 let staticZ=max(vec4f(0.0),vsmPyramidGather(t.texel,t.slice));
 vsmPyramidFirst(t,lane,layer,staticZ);
 for(var level=1u;level<${tileLevels}u;level++){
  workgroupBarrier();
  vsmPyramidHalve(level,t,lane,layer);
 }
 // With a layer of the dynamic casters, the first is built from the dynamic slice merged with the
 // static (for a page redrawn whole that is the build it just made, slice 0 with itself; the barriers
 // stay in uniform control flow).
 if(vsm.hzbStaticLayer!=0u){
  workgroupBarrier();
  vsmPyramidFirst(t,lane,0u,max(staticZ,max(vec4f(0.0),vsmPyramidGather(t.texel,0u))));
  for(var level=1u;level<${tileLevels}u;level++){
   workgroupBarrier();
   vsmPyramidHalve(level,t,lane,0u);
  }
 }
}`

/**
 * The tile kernel: group 1 = 0 the listed pages, 1 on the levels 0 to `tileLevels` - 1 (storage, one
 * level each; `pyramidTileLevels`). Dispatch (16, pages, 1), indirect.
 */
export const vsmBuildPyramidWgsl = (layout: VsmLayout, tileLevels = PYRAMID_TILE_LEVELS) =>
  wgslProgram(
    /* wgsl */ `
${pyramidTileHelpersText(tileLevels)}${pyramidTileKernelText(tileLevels)}
`,
    [
      VSM_CONSTANTS_WGSL,
      vsmBindingsWgsl(0, PYRAMID_BUILD_SPECS, layout),
      TILE_WGSL,
      REDUCTION_POSITION_WGSL,
    ],
  )

/** The top kernel's levels from the tile kernel's last of four storage views (level 3): level 4 from
 *  level 3 by 4x4 threads, level 5 by 2x2 of them, level 6 by one. */
const TOP_FROM_LEVEL_3_TEXT = /* wgsl */ `
var<workgroup> pyramidTop4:array<f32,16>;
var<workgroup> pyramidTop5:array<f32,4>;
/** Level 4: thread \`local\` of page \`page\` (4x4 threads), the least of its 2x2 texels of level 3. */
fn vsmPyramidTopFirst(page:vec2u,local:vec2u,layer:u32){
 let at=page*8u+(local<<vec2u(1u));
 let least=min(
  min(textureLoad(pyramidLevel3,vec2u(at.x,at.y+1u),layer,0u).x,textureLoad(pyramidLevel3,at+vec2u(1u),layer,0u).x),
  min(textureLoad(pyramidLevel3,vec2u(at.x+1u,at.y),layer,0u).x,textureLoad(pyramidLevel3,at,layer,0u).x));
 pyramidTop4[local.y*4u+local.x]=least;
 textureStore(pyramidLevel4,at>>vec2u(1u),layer,vec4f(least));
}
/** Level 5: the 2x2 threads, each the least of its 2x2 of level 4. */
fn vsmPyramidTopSecond(page:vec2u,local:vec2u,layer:u32){
 if(any(local>=vec2u(2u))){return;}
 let k=local.y*8u+local.x*2u;
 let least=min(min(pyramidTop4[k],pyramidTop4[k+1u]),min(pyramidTop4[k+4u],pyramidTop4[k+5u]));
 pyramidTop5[local.y*2u+local.x]=least;
 textureStore(pyramidLevel5,page*2u+local,layer,vec4f(least));
}`

/** And from level 4 (the tile kernel wrote it): level 5 by 2x2 threads, each the least of its 2x2 texels
 *  of level 4, level 6 by one. */
const TOP_FROM_LEVEL_4_TEXT = /* wgsl */ `
var<workgroup> pyramidTop5:array<f32,4>;
/** Level 5: the 2x2 threads of page \`page\`, each the least of its 2x2 texels of level 4. */
fn vsmPyramidTopSecond(page:vec2u,local:vec2u,layer:u32){
 if(any(local>=vec2u(2u))){return;}
 let at=page*4u+(local<<vec2u(1u));
 let least=min(
  min(textureLoad(pyramidLevel4,vec2u(at.x,at.y+1u),layer,0u).x,textureLoad(pyramidLevel4,at+vec2u(1u),layer,0u).x),
  min(textureLoad(pyramidLevel4,vec2u(at.x+1u,at.y),layer,0u).x,textureLoad(pyramidLevel4,at,layer,0u).x));
 pyramidTop5[local.y*2u+local.x]=least;
 textureStore(pyramidLevel5,page*2u+local,layer,vec4f(least));
}`

/**
 * The top kernel: group 1 = 0 the listed pages, 1 the tile kernel's last level (sampled, by load), the
 * levels past it (storage), 4 to 6 after the four levels of the tile kernel and 5 and 6 after its five
 * (`tileLevels`, `pyramidTileLevels`). Dispatch (pages, 1, 1), indirect.
 */
export const vsmBuildPyramidTopWgsl = (layout: VsmLayout, tileLevels = PYRAMID_TILE_LEVELS) => {
  const fromLevel4 = tileLevels > PYRAMID_TILE_LEVELS
  return wgslProgram(
    /* wgsl */ `
@group(1) @binding(0) var<storage,read> pyramidPages:array<u32>;
@group(1) @binding(1) var pyramidLevel${tileLevels - 1}:texture_2d_array<f32>;
${levelStores(tileLevels, pyramidTopLevels(tileLevels), 2)}${fromLevel4 ? TOP_FROM_LEVEL_4_TEXT : TOP_FROM_LEVEL_3_TEXT}
/** Level 6: the first thread, the least of level 5's four. */
fn vsmPyramidTopLast(page:vec2u,local:vec2u,layer:u32){
 if(any(local!=vec2u(0u))){return;}
 let least=min(min(pyramidTop5[0],pyramidTop5[1]),min(pyramidTop5[2],pyramidTop5[3]));
 textureStore(pyramidLevel6,page,layer,vec4f(least));
}
@compute @workgroup_size(4,4)
fn vsmBuildPyramidTop(@builtin(local_invocation_id) local:vec3u,@builtin(workgroup_id) wid:vec3u){
 let page=vsmPoolPageOf(pyramidPages[wid.x]);
 // Each layer the pyramid holds (the static casters' is the last).
 for(var layer=0u;layer<=vsm.hzbStaticLayer;layer++){${
   fromLevel4
     ? ''
     : `
  vsmPyramidTopFirst(page,local.xy,layer);
  workgroupBarrier();`
 }
  vsmPyramidTopSecond(page,local.xy,layer);
  workgroupBarrier();
  vsmPyramidTopLast(page,local.xy,layer);
  workgroupBarrier();
 }
}
`,
    [VSM_CONSTANTS_WGSL, vsmBindingsWgsl(0, PYRAMID_TOP_SPECS, layout), VSM_PAGE_ADDRESS_WGSL],
  )
}
