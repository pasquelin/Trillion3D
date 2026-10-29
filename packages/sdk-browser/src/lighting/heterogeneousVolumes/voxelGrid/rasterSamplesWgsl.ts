import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { blueNoiseWgsl } from '../../../gpu/noise/blueNoiseWgsl.ts'
import { VG_TYPES_WGSL } from './gridTypesWgsl.ts'
import { VG_RASTER_PARAMS_WGSL } from './rasterParamsWgsl.ts'
import { VG_RASTER_TILE_OF } from './rasterTilesWgsl.ts'

/** The voxels of a raster tile, and so the samples it takes in the sample buffer. */
export const VG_TILE_VOXELS = 64
/** The vectors of the sample buffer a voxel takes: its world position (the fourth component one where the voxel is a voxel of its cell), then
 *  the extinction, the emission and the scattering the volume's material gives there. */
export const VG_SAMPLE_VECTORS = 4

/**
 * THE VOXELS A VOLUME IS SAMPLED AT, in the tiles (the first of three steps of RasterizeBottomLevelOrthoGridCS and RasterizeBottomLevelFrustumGridCS: this
 * one finds the world position of each voxel of a tile, the volume's material is evaluated at them by the volume's own program, the last folds the
 * results into the grid): one group a tile, a thread a voxel of the 4 x 4 x 4 tile. A voxel of the ortho grid's cell lies at its place in the cell,
 * its centre or a point of it drawn from the blue noise, the bottom level's resolution (times the indirection grid's) cut into the tile; a voxel of
 * the frustum grid's cell lies in the slice of the frustum, through the view space to the world, jittered in depth only. A cell the volume's box
 * does not meet, and a voxel past the cell's resolution, are left out.
 *
 * Bindings: 0 the parameters (uniform), 1 the top-level cells (storage), 2 the tiles, 3 the allocators (storage, atomic; the tiles made are
 * word 2), 4 the samples (storage), 5 the blue noise.
 */
export const VG_PREPARE_RASTER_SAMPLES_WGSL = wgslProgram(
  `@group(0) @binding(0) var<uniform> params:VgRasterParams;
@group(0) @binding(1) var<storage,read> topLevel:array<u32>;
@group(0) @binding(2) var<storage,read> tiles:array<vec2u>;
@group(0) @binding(3) var<storage,read_write> allocators:array<atomic<u32>>;
@group(0) @binding(4) var<storage,read_write> samples:array<vec4f>;

/** The place of a voxel of the frustum grid's bottom level in the world: its cell, its voxel in it and a depth jitter. */
fn frustumVoxelToWorld(cell:vec3u,voxel:vec3u,resolution:u32)->vec3f{
 let jitter=select(0.5,blueNoiseScalar((cell*resolution+voxel).xy,params.frame),params.jitter!=0);
 let position=vec3f(cell)+(vec3f(voxel)+vec3f(0.5,0.5,jitter))/f32(resolution);
 let ndc=position/vec3f(params.resolution);
 let screen=ndc.xy*2.0-vec2f(1.0);
 let depth=ndc.z*(params.frustum.z-params.frustum.y)+params.frustum.y;
 let aspect=vec2f(params.resolution.xy)/f32(params.resolution.x);
 let view=vec3f(screen*params.frustum.x*aspect*depth,depth);
 return (params.viewToWorld*vec4f(view,1.0)).xyz;
}

@compute @workgroup_size(4,4,4)
fn prepareRasterSamples(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_id) local:vec3u){
 let tile=rasterTileOf(block);
 var place=vec4f(0.0);
 if(tile<atomicLoad(&allocators[2])){
  let entry=tiles[tile];
  let cell=vgVoxelOf(entry.x,params.resolution);
  var resolution=topLevel[entry.x]&7u;
  if(params.grid==0){
   let extent=(params.boundsMax-params.boundsMin)/vec3f(params.resolution);
   let cellMin=params.boundsMin+extent*vec3f(cell);
   let meets=!(any(params.primitiveMin>cellMin+extent)||any(cellMin>params.primitiveMax));
   if(meets){
    // With the indirection grid a tile is one indirection cell of the top-level cell, the fixed bottom level inside it.
    if(params.indirection!=0){resolution*=u32(params.fixedResolution);}
    let voxel=mortonDecode3(entry.y)*4u+local;
    let voxel2d=vec2u(voxel.y*resolution+voxel.x,voxel.z);
    var jitter=vec3f(0.5);
    if(params.jitter!=0){jitter=vec3f(blueNoiseVec2(voxel2d,params.frame),blueNoiseScalar(voxel2d,params.frame));}
    let inCell=(vec3f(voxel)+jitter)/f32(resolution);
    place=vec4f(inCell*extent+cellMin,select(0.0,1.0,all(voxel<vec3u(resolution))));
   }
  }else{
   let inside=all(local<vec3u(resolution));
   let world=frustumVoxelToWorld(cell,local,resolution);
   let meets=all(world>=params.primitiveMin)&&all(world<=params.primitiveMax);
   place=vec4f(world,select(0.0,1.0,inside&&meets));
  }
 }
 samples[(tile*${VG_TILE_VOXELS}u+mortonEncode3(local))*${VG_SAMPLE_VECTORS}u]=place;
}`,
  [VG_TYPES_WGSL, VG_RASTER_PARAMS_WGSL, VG_RASTER_TILE_OF, blueNoiseWgsl(0, 5)],
)
