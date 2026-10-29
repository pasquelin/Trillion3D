import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { VG_TYPES_WGSL } from './gridTypesWgsl.ts'

/** The bytes of one volume's parameters (`VgMarkParams`); a dispatch binds its own slot at a dynamic offset of 256. */
export const VG_MARK_PARAMS_BYTES = 128

/**
 * THE CELLS OF THE FRUSTUM GRID A VOLUME TOUCHES: one dispatch a volume. A cell is a slice of the view's frustum between two depths; the
 * sphere round it is tested against the sphere round the volume's bounds, and a cell they meet gets bottom-level cells along every side
 * (the bottom level's resolution), a cell they do not keeps what the cell held. Every cell leaves with no bottom-level index.
 *
 * Bindings: 0 the parameters (uniform, dynamic offset), 1 the top-level cells (storage).
 */
export const VG_MARK_FRUSTUM_GRID_WGSL = wgslProgram(
  `struct VgMarkParams{
 viewToWorld:mat4x4f,
 primitiveMin:vec3f,
 tanHalfFov:f32,
 primitiveMax:vec3f,
 nearDepth:f32,
 resolution:vec3i,
 farDepth:f32,
 // The cells a side of one bottom-level cell holds.
 bottomResolution:vec4u,
}
@group(0) @binding(0) var<uniform> params:VgMarkParams;
@group(0) @binding(1) var<storage,read_write> topLevel:array<u32>;

fn vgVoxelToView(position:vec3f)->vec3f{
 let ndc=position/vec3f(params.resolution);
 let screen=ndc.xy*2.0-vec2f(1.0);
 let depth=ndc.z*(params.farDepth-params.nearDepth)+params.nearDepth;
 let aspect=vec2f(params.resolution.xy)/f32(params.resolution.x);
 return vec3f(screen*params.tanHalfFov*aspect*depth,depth);
}
fn vgSphereMeetsCell(centre:vec3f,radius:f32,cell:vec3f)->bool{
 let lo=(params.viewToWorld*vec4f(vgVoxelToView(cell),1.0)).xyz;
 let hi=(params.viewToWorld*vec4f(vgVoxelToView(cell+vec3f(1.0)),1.0)).xyz;
 return length(centre-(lo+hi)*0.5)<radius+length((hi-lo)*0.5);
}

@compute @workgroup_size(4,4,4)
fn markTopLevelGridVoxelsForFrustumGrid(@builtin(global_invocation_id) id:vec3u){
 if(any(vec3i(id)>=params.resolution)){return;}
 let index=vgLinearIndex(id,params.resolution);
 var cells=topLevel[index]&7u;
 let centre=(params.primitiveMax+params.primitiveMin)*0.5;
 let halfSize=(params.primitiveMax-params.primitiveMin)*0.5;
 if(vgSphereMeetsCell(centre,length(halfSize),vec3f(id))){cells=params.bottomResolution.x;}
 topLevel[index]=vgSetBottomResolution(vgSetBottomIndex(topLevel[index],VG_EMPTY_INDEX),cells);
}`,
  [VG_TYPES_WGSL],
)
