import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * THE CULL OF THE SCENE'S MESHES TO A VIEW, the pieces the passes that list meshes for a view share (the occlusion's
 * `dfaoCullObjects`, the sun's shadow `dfshCull`, the meshes' trace `msdfCullObjects`): a thread a mesh of the scene, the
 * mesh listed if its pass's own predicates keep it and it is drawn at its distance from the eye. The passes keep what is
 * theirs (the radius a mesh must have, the range it lights, the hull of a cascade); this holds what is not.
 *
 * - `dfCullInFrustum`: a sphere that no plane of the frustum (`dot(xyz, p) − w` positive outside) puts wholly outside;
 * - `dfCullDistanceSquared`: the squared distance from the eye to a point given by its vector, under an orthographic
 *   projection the length over the view's forward component, squared, so that an object off the axis is farther;
 * - `dfCullDrawn`: whether a mesh is drawn at its squared distance (over `range.x` if that is above 0.0001, under `range.y` likewise);
 * - the listing (`dfCullGroupWgsl`): a group at a time, one atomic add on the list for the group's share, the mesh's rank kept in
 *   the group's memory until then.
 */
export const DF_CULL_HELPERS_WGSL = wgslBlock(
  'DF_CULL_HELPERS_WGSL',
  [],
  `fn dfCullDistanceSquared(v:vec3f,perspective:bool,forward:vec3f)->f32{
 if(perspective){return dot(v,v);}
 let along=dot(v,forward);
 if(along==0.0){return 3.0e38;}
 let d=dot(v,v)/along;
 return d*d;
}
fn dfCullDrawn(range:vec2f,distanceSquared:f32)->bool{
 return (range.x<0.0001||distanceSquared>range.x)&&(range.y<0.0001||distanceSquared<range.y);
}`,
)

/**
 * The frustum test over the planes of a pass's uniform: `planes` the array of the planes (\`vec4f\`), \`count\` the number of
 * them in use, as WGSL expressions.
 */
export const dfCullFrustumWgsl = (planes: string, count: string) =>
  wgslBlock(
    `dfCullFrustumWgsl(${planes}, ${count})`,
    [],
    `fn dfCullInFrustum(center:vec3f,radius:f32)->bool{
 for(var plane=0u;plane<${count};plane++){
  let p=${planes}[plane];
  if(dot(p.xyz,center)-p.w>radius){return false;}
 }
 return true;
}`,
  )

/**
 * The compaction kernel of a pass that lists its meshes by group: entry \`entry\`, \`group\` threads; \`meshes\` the number of meshes of
 * the scene, \`indexCount\` the index count of the bounding sphere the list is drawn with (written to \`objectArgs[0]\` by the first
 * thread, the list's size being \`objectArgs[1]\`), as WGSL expressions. The pass defines
 * \`fn dfCullKeeps(index:u32,bounds:DfObjectBounds,centre:vec3f)->bool\`, which holds its own predicates and the draw distance.
 * The host clears the arguments to zero before the pass.
 */
export const dfCullGroupWgsl = (entry: string, group: number, meshes: string, indexCount: string) =>
  wgslBlock(
    `dfCullGroupWgsl(${entry}, ${group}, ${meshes}, ${indexCount})`,
    [],
    `var<workgroup> groupCount:atomic<u32>;
var<workgroup> groupBase:u32;
var<workgroup> groupObjects:array<u32,${group}>;
@compute @workgroup_size(${group})
fn ${entry}(@builtin(global_invocation_id) id:vec3u,@builtin(local_invocation_index) lane:u32){
 if(id.x==0u){atomicStore(&objectArgs[0],${indexCount});}
 if(lane==0u){atomicStore(&groupCount,0u);}
 workgroupBarrier();
 if(id.x<${meshes}){
  let bounds=loadDfObjectBounds(id.x);
  let centre=bounds.center.hi+bounds.center.lo;
  if(dfCullKeeps(id.x,bounds,centre)){groupObjects[atomicAdd(&groupCount,1u)]=id.x;}
 }
 workgroupBarrier();
 let count=atomicLoad(&groupCount);
 if(lane==0u){groupBase=atomicAdd(&objectArgs[1],count);}
 workgroupBarrier();
 if(lane<count){culledObjects[groupBase+lane]=groupObjects[lane];}
}`,
  )
