/**
 * THE COPIES BETWEEN THE ATLAS AND THE POOL (`shadowVirtualEnable` off). The pool keeps the pages from one image to the next (the page management cleared the pages to draw, and
 * initialised them from the static layer where it is cached), so it is the cache of the classic maps: a tile of the atlas is first filled from it, the casters are drawn over, and the
 * tile goes back to it.
 *
 * - IN, `vsmAtlasCopyVs` / `vsmAtlasCopyFs`: a triangle over a tile (a viewport and a scissor on it, the map's id the first instance) whose fragment writes the depth the pool holds at the
 *   tile's texel, through the page table; a page that is not one to draw at the tile's mip leaves the texel at the clear value. `ATLAS_STATIC` picks the pool's slice: the dynamic one or
 *   the static one.
 * - OUT, `vsmAtlasCopyOut`: a row of groups a map, the threads of a group walking the tile's texels; each layer's depth joins the pool's slice by the same atomic maximum the raster uses,
 *   so what the voxel rows wrote to the pool meanwhile is kept. `ATLAS_LAYERS`: the layers an atlas has (the static one when 2); the texture holds them atlas after atlas.
 */
import { wgslProgram } from '../../../../../../math/src/wgsl/assemble.ts'
import { VSM_CONSTANTS_WGSL } from '../../vsm/constants.ts'
import type { VsmLayout } from '../../vsm/layout.ts'
import {
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
  VSM_TABLE_ORIGIN_WGSL,
} from '../../vsm/pageTableWgsl.ts'
import { VSM_PROJECTION_DATA_WGSL } from '../../vsm/projection/projectionDataWgsl.ts'
import { vsmBindingsWgsl, type VsmBindingSpec } from '../../vsm/resources.ts'
import { atlasTileWgsl } from './atlasTileWgsl.ts'

/** The groups of a copy: the atlas buffer at `ATLAS_COPY_ATLAS_BINDING`, the VSM tables at group 0 and the depth texture (out) at group 1. */
export const ATLAS_COPY_ATLAS_BINDING = 0
/** The threads a group of the copy out has, and the groups across a map's row. */
export const ATLAS_COPY_THREADS = 64
export const ATLAS_COPY_GROUPS_ACROSS = 64

/** The VSM tables a copy reads (and in the out, the pool it joins to). */
export const atlasCopySpecs = (poolAccess: 'read' | 'atomic'): readonly VsmBindingSpec[] => [
  { resource: 'uniforms', binding: 1 },
  { resource: 'projectionData', binding: 2 },
  { resource: 'pageTable', binding: 3 },
  { resource: 'pagePool', binding: 4, access: poolAccess },
]

/** The pool texel a tile texel `rel` of map `map` is at, through the page table: none (false) past the map or on a page that is not one to draw at the tile's mip. */
const TILE_TEXEL_WGSL = `fn vsmAtlasPoolTexel(map:u32,tile:VsmAtlasTile,rel:vec2u,texel:ptr<function,vec2u>)->bool{
 let at=tile.mapCorner+rel;
 if(any(at>=vec2u(vsmTexelsAtLevel(tile.mip)))){return false;}
 let entry=vsmUnpackTableEntry(vsmTableWord(vsmTableEntryOf(vsmHandleFromId(map),tile.mip,at>>vec2u(VSM_LOG2_PAGE))));
 if(!entry.thisLevelDrawable){return false;}
 *texel=entry.physicalAddress*VSM_PAGE_TEXELS+(at&vec2u(VSM_PAGE_TEXEL_MASK));
 return true;
}`

const copyDeps = (layout: VsmLayout, access: 'read' | 'atomic') => [
  VSM_CONSTANTS_WGSL,
  VSM_HANDLE_WGSL,
  VSM_PAGE_ADDRESS_WGSL,
  VSM_TABLE_ORIGIN_WGSL,
  VSM_PAGE_LOOKUP_WGSL,
  VSM_PROJECTION_DATA_WGSL,
  vsmBindingsWgsl(0, atlasCopySpecs(access), layout),
  atlasTileWgsl(0, ATLAS_COPY_ATLAS_BINDING),
]

/** The copy in (entries `vsmAtlasCopyVs`, `vsmAtlasCopyFs`). */
export const vsmAtlasCopyInWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
override ATLAS_STATIC:u32=0u;
${TILE_TEXEL_WGSL}
struct VsmAtlasCopyOut{@builtin(position) position:vec4f,@location(0) @interpolate(flat) map:u32,}
struct VsmAtlasCopyDepth{@builtin(frag_depth) depth:f32,}
@vertex fn vsmAtlasCopyVs(@builtin(vertex_index) i:u32,@builtin(instance_index) map:u32)->VsmAtlasCopyOut{
 var out:VsmAtlasCopyOut;
 out.position=vec4f(vec2f(f32((i<<1u)&2u),f32(i&2u))*2.0-1.0,0.0,1.0);
 out.map=map;
 return out;
}
@fragment fn vsmAtlasCopyFs(in:VsmAtlasCopyOut)->VsmAtlasCopyDepth{
 let tile=vsmAtlasTileOf(in.map);
 var texel:vec2u;
 if(!tile.valid||!vsmAtlasPoolTexel(in.map,tile,vec2u(in.position.xy)-tile.corner,&texel)){discard;}
 var out:VsmAtlasCopyDepth;
 out.depth=bitcast<f32>(vsmPoolLoad(texel,select(0u,vsm.staticSlice,ATLAS_STATIC!=0u)));
 return out;
}`,
    copyDeps(layout, 'read'),
  )

/** The copy out (entry `vsmAtlasCopyOut`). */
export const vsmAtlasCopyOutWgsl = (layout: VsmLayout) =>
  wgslProgram(
    /* wgsl */ `
override ATLAS_LAYERS:u32=1u;
@group(1) @binding(0) var vsmAtlasDepth:texture_depth_2d_array;
${TILE_TEXEL_WGSL}
@compute @workgroup_size(${ATLAS_COPY_THREADS}) fn vsmAtlasCopyOut(@builtin(global_invocation_id) id:vec3u){
 let tile=vsmAtlasTileOf(id.y);
 if(!tile.valid){return;}
 for(var k=id.x;k<tile.side*tile.side;k+=${ATLAS_COPY_GROUPS_ACROSS * ATLAS_COPY_THREADS}u){
  let rel=vec2u(k%tile.side,k/tile.side);
  var texel:vec2u;
  if(!vsmAtlasPoolTexel(id.y,tile,rel,&texel)){continue;}
  for(var layer=0u;layer<ATLAS_LAYERS;layer++){
   let depth=textureLoad(vsmAtlasDepth,vec2i(tile.corner+rel),i32(tile.page*ATLAS_LAYERS+layer),0);
   if(depth>0.0){vsmPoolAtomicMax(texel,select(0u,vsm.staticSlice,layer!=0u),bitcast<u32>(depth));}
  }
 }
}`,
    copyDeps(layout, 'atomic'),
  )
