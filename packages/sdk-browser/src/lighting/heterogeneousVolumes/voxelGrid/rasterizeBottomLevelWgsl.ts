import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { luminance } from '../../../../../math/src/wgsl/color.ts'
import { VG_TYPES_WGSL } from './gridTypesWgsl.ts'
import { VG_RASTER_PARAMS_WGSL } from './rasterParamsWgsl.ts'
import { VG_RASTER_TILE_OF } from './rasterTilesWgsl.ts'
import { VG_SAMPLE_VECTORS, VG_TILE_VOXELS } from './rasterSamplesWgsl.ts'

/**
 * THE SAMPLES OF A VOLUME FOLDED INTO THE GRID (the last step of RasterizeBottomLevelOrthoGridCS and RasterizeBottomLevelFrustumGridCS; the samples are
 * made by `prepareRasterSamples` and the volume's own program): one group a tile, a thread a voxel. The extinction, the emission and the
 * scattering of the tile's voxels are summed over the group; a tile whose extinction sums to nothing allocates no bottom level, one that has some
 * takes its cells from the pool (without the indirection grid the top-level cell's own, with it the tile's indirection cell's) and writes
 * them, adding to what an earlier volume left there.
 *
 * With the homogeneous aggregation (the ortho grid) a tile whose extinction hardly varies, below the relative error of the threshold and with
 * under four voxels without extinction, is stored as one voxel holding the means; a tile an earlier volume stored as one voxel takes the means of
 * this one too (the reference writes the cells of a full tile into the one voxel's place). The sums are trees over the group (the reference
 * sums one voxel into its neighbour in place, with no barrier between the reads and the writes, and keeps the emission and the scattering of
 * the first voxel alone for the aggregate: corrected). The variance counts the voxels of the tile only (the reference counts the threads past
 * a smaller tile's resolution as voxels without extinction).
 *
 * Bindings: 0 the parameters (uniform), 1 the top-level cells, 2 the indirection cells, 3 the extinction cells, 4 the emission and scattering
 * cells (four words each), 5 the allocators (atomic; word 0 the bottom-level cells given out, 2 the tiles made), 6 the tiles (read), 7 the
 * samples (read) (all storage). The group's first thread decides what the tile holds; every thread writes its voxel after the barrier.
 */
export const VG_RASTERIZE_BOTTOM_LEVEL_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> params:VgRasterParams;
@group(0) @binding(1) var<storage,read_write> topLevel:array<u32>;
@group(0) @binding(2) var<storage,read_write> indirectionGrid:array<u32>;
@group(0) @binding(3) var<storage,read_write> extinctionGrid:array<vec2u>;
@group(0) @binding(4) var<storage,read_write> materialGrid:array<vec4u>;
@group(0) @binding(5) var<storage,read_write> allocators:array<atomic<u32>>;
@group(0) @binding(6) var<storage,read> tiles:array<vec2u>;
@group(0) @binding(7) var<storage,read> samples:array<vec4f>;

const EXTINCTION_FLOOR=1.0e-6;
const EMPTY_VOXEL_THRESHOLD=1.0e-5;

var<workgroup> sumExtinction:array<vec3f,${VG_TILE_VOXELS}>;
var<workgroup> sumEmission:array<vec3f,${VG_TILE_VOXELS}>;
var<workgroup> sumScattering:array<vec3f,${VG_TILE_VOXELS}>;
var<workgroup> sumCount:array<f32,${VG_TILE_VOXELS}>;
// The variance of the extinction about its mean and the voxels without extinction.
var<workgroup> sumShape:array<vec2f,${VG_TILE_VOXELS}>;
// What the first thread decides: the cells the tile holds, the first, whether they are one voxel standing for the tile and whether they were there before.
var<workgroup> groupCells:u32;
var<workgroup> groupFirst:u32;
var<workgroup> groupFlat:u32;
var<workgroup> groupBefore:u32;

@compute @workgroup_size(4,4,4)
fn rasterizeBottomLevelGrid(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_id) local:vec3u){
 let tile=rasterTileOf(block);
 let slot=mortonEncode3(local);
 let running=tile<atomicLoad(&allocators[2]);
 let at=(tile*${VG_TILE_VOXELS}u+slot)*${VG_SAMPLE_VECTORS}u;
 var extinction=vec3f(0.0);
 var emission=vec3f(0.0);
 var scattering=vec3f(0.0);
 var inTile=false;
 var entry=vec2u(0u);
 var baseSide=1u;
 if(running){
  entry=tiles[tile];
  baseSide=select(topLevel[entry.x]&7u,u32(params.fixedResolution),params.indirection!=0);
  inTile=samples[at].w>0.5;
  extinction=samples[at+1u].xyz;
  emission=samples[at+2u].xyz;
  scattering=samples[at+3u].xyz;
 }
 let baseCells=baseSide*baseSide*baseSide;
 sumExtinction[slot]=extinction;
 sumEmission[slot]=emission;
 sumScattering[slot]=scattering;
 sumCount[slot]=select(0.0,1.0,inTile);
 workgroupBarrier();
 for(var stride=${VG_TILE_VOXELS / 2}u;stride>0u;stride=stride>>1u){
  if(slot<stride){
   sumExtinction[slot]+=sumExtinction[slot+stride];
   sumEmission[slot]+=sumEmission[slot+stride];
   sumScattering[slot]+=sumScattering[slot+stride];
   sumCount[slot]+=sumCount[slot+stride];
  }
  workgroupBarrier();
 }

 // The spread of the extinction about its mean, and the voxels that hold none.
 let mean=sumExtinction[0]/f32(baseCells);
 let away=mean-extinction;
 sumShape[slot]=select(vec2f(0.0),vec2f(dot(away,away),select(0.0,1.0,all(extinction<vec3f(EMPTY_VOXEL_THRESHOLD)))),inTile);
 workgroupBarrier();
 for(var stride=${VG_TILE_VOXELS / 2}u;stride>0u;stride=stride>>1u){
  if(slot<stride){sumShape[slot]+=sumShape[slot+stride];}
  workgroupBarrier();
 }

 if(slot==0u){
  groupCells=0u;
  groupFirst=VG_EMPTY_INDEX;
  groupFlat=0u;
  groupBefore=0u;
  if(running&&sumCount[0]>0.5){
   let indirect=params.indirection!=0;
   let cellsAt=vgBottomIndex(topLevel[entry.x])+entry.y;
   var cellWord=topLevel[entry.x];
   if(indirect){cellWord=indirectionGrid[cellsAt];}
   if(vgIsAllocated(cellWord)){
    let side=cellWord&7u;
    groupBefore=1u;
    groupFirst=vgBottomIndex(cellWord);
    groupCells=side*side*side;
    groupFlat=select(0u,1u,side==1u&&baseSide>1u);
   }else{
    var holds=luminance(sumExtinction[0])>EXTINCTION_FLOOR;
    if(params.grid==0){holds=any(sumExtinction[0]>vec3f(EXTINCTION_FLOOR));}
    if(holds){
     var side=baseSide;
     groupCells=baseCells;
     // A region of the ortho grid whose extinction hardly varies is one voxel.
     if(params.grid==0&&params.frustum.w>=0.0&&baseCells>1u){
      let variance=sumShape[0].x/f32(baseCells-1u);
      let spread=sqrt(variance/f32(baseCells))/luminance(mean);
      if(spread<params.frustum.w&&sumShape[0].y<4.0){
       groupFlat=1u;
       groupCells=1u;
       side=1u;
      }
     }
     groupFirst=atomicAdd(&allocators[0],groupCells);
     if(groupFirst+groupCells>params.pool.x){
      atomicStore(&allocators[0],params.pool.x);
      groupFirst=VG_EMPTY_INDEX;
      groupCells=0u;
      side=0u;
     }
     let made=(groupFirst<<3u)|(side&7u);
     if(indirect){indirectionGrid[cellsAt]=made;}else{topLevel[entry.x]=made;}
    }
   }
  }
 }
 workgroupBarrier();

 if(running&&slot<groupCells&&groupFirst!=VG_EMPTY_INDEX){
  let cell=groupFirst+slot;
  var writeExtinction=extinction;
  var writeEmission=emission;
  var writeScattering=scattering;
  if(groupFlat!=0u){
   writeExtinction=mean;
   writeEmission=sumEmission[0]/f32(baseCells);
   writeScattering=sumScattering[0]/f32(baseCells);
  }
  if(groupBefore!=0u){
   writeExtinction+=vgColorOf(extinctionGrid[cell]);
   writeEmission+=vgColorOf(materialGrid[cell].xy);
   writeScattering+=vgColorOf(materialGrid[cell].zw);
  }
  extinctionGrid[cell]=vgSetColor(writeExtinction);
  materialGrid[cell]=vec4u(vgSetColor(writeEmission),vgSetColor(writeScattering));
 }
}`,
  [VG_TYPES_WGSL, VG_RASTER_PARAMS_WGSL, VG_RASTER_TILE_OF, luminance],
)
