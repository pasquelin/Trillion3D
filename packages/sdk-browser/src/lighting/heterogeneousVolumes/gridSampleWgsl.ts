import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'
import { MORTON } from '../../hair/voxelMipWgsl.ts'
import { HV_RAY_MARCH_WGSL } from './liveShadingWgsl.ts'
import { VG_RASTER_TILE_OF } from './voxelGrid/rasterTilesWgsl.ts'
import { VG_SAMPLE_VECTORS, VG_TILE_VOXELS } from './voxelGrid/rasterSamplesWgsl.ts'

/** The group, and the binding in it, of the buffer of samples the volume's program reads the positions of and writes the material at. */
export const HV_GRID_SAMPLE_BINDING = { group: 1, binding: 0 } as const

const SQRT_THREE = 1.7320508075688772

/**
 * THE VOLUME'S MATERIAL AT THE VOXELS OF A GRID (the middle step of the rasterization of a volume into a voxel grid; the program of the volume holds
 * the material, so it evaluates it): a group a tile, a thread a voxel. The world position `prepareRasterSamples` left in a voxel's sample, where
 * it lies in the volume's bounds, is given the volume's extinction, its emission and its scattering (the albedo times the extinction), the
 * extinction and the emission turned from a density per local unit to one per world unit (over the length of the diagonal of the volume's unit
 * cube, times the square root of three; the reference leaves the emission of the frustum grid as the material gives it: corrected). A voxel
 * outside the volume, or one the tile does not have, is left with none.
 *
 * Bindings (group 1): 0 the samples (storage, read and write), four vectors a voxel (`VG_SAMPLE_VECTORS`), the position first.
 */
export const HV_GRID_SAMPLE_WGSL = wgslBlock(
  'HV_GRID_SAMPLE_WGSL',
  [HV_RAY_MARCH_WGSL, VG_RASTER_TILE_OF, MORTON],
  `@group(${HV_GRID_SAMPLE_BINDING.group}) @binding(${HV_GRID_SAMPLE_BINDING.binding}) var<storage,read_write> rasterSamples:array<vec4f>;

@compute @workgroup_size(4,4,4)
fn hvGridSampleMain(@builtin(workgroup_id) block:vec3u,@builtin(local_invocation_id) inTile:vec3u){
 hvInit();
 let at=(rasterTileOf(block)*${VG_TILE_VOXELS}u+mortonEncode3(inTile))*${VG_SAMPLE_VECTORS}u;
 if(at+${VG_SAMPLE_VECTORS - 1}u>=arrayLength(&rasterSamples)){return;}
 let place=rasterSamples[at];
 var extinction=vec3f(0.0);
 var emission=vec3f(0.0);
 var scattering=vec3f(0.0);
 let local=(hv.worldToLocal*vec4f(place.xyz,1.0)).xyz;
 let boundsMin=hv.boundsOrigin.xyz-hv.boundsExtent.xyz;
 let boundsMax=hv.boundsOrigin.xyz+hv.boundsExtent.xyz;
 if(place.w>0.5&&all(local>=boundsMin)&&all(local<=boundsMax)){
  let unit=length((hv.localToWorld*vec4f(1.0,1.0,1.0,1.0)).xyz-(hv.localToWorld*vec4f(0.0,0.0,0.0,1.0)).xyz);
  let toWorld=${SQRT_THREE}/unit;
  extinction=hvSampleExtinction(local,place.xyz)*toWorld;
  emission=hvSampleEmission(local,place.xyz)*toWorld;
  scattering=hvSampleAlbedo(local,place.xyz)*extinction;
 }
 rasterSamples[at+1u]=vec4f(extinction,0.0);
 rasterSamples[at+2u]=vec4f(emission,0.0);
 rasterSamples[at+3u]=vec4f(scattering,0.0);
}`,
)
