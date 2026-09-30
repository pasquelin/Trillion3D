import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { DEPTH_NEAR } from '../../camera/depthConvention.ts';

/**
 * Clustered light assignment (#1249): a screen tile's opaque slice is cut into `CLUSTER_SLICES`
 * logarithmically spaced clusters along the view axis, and a pixel reads the cluster its own
 * depth falls in. A light is assigned to every cluster its range sphere can reach, so the list a
 * pixel walks holds no light that would have contributed exactly zero there (`directIncidence`)
 * and misses none that reaches it — the sum is develop's, term for term, without the zeros.
 *
 * The slice is a function of the **axis distance** (the view-space depth the projection measures),
 * not the Euclidean distance: for a pixel `p` and a light centre `c`, `|axis(p) − axis(c)|` is the
 * projection of `p − c` on the view axis, hence at most `|p − c|`. A light of radius `r` that
 * reaches a pixel at axis distance `d` therefore has its centre within `[d − r, d + r]`, which is
 * exactly the span this file assigns. The resolve reads the cluster from the pixel's depth
 * (`near / depth`) and the tile's own nearest and farthest surfaces, both already reduced by the
 * tile pass.
 *
 * `1` slice is the undeformed tile: one list, the whole opaque slice.
 */
export const clusterSliceIndexWgsl = `
/** Cluster of an axis \`distance\`, in [0, CLUSTER_SLICES): logarithmic between the tile's nearest
 *  (\`front\`) and farthest (\`back\`) surface. A flat tile, or a point before its front, is the
 *  first cluster; a point past its back the last. */
fn clusterSliceIndex(distance:f32,front:f32,back:f32)->u32{
 if(back<=front||distance<=front){return 0u;}
 if(distance>=back){return CLUSTER_SLICES-1u;}
 let t=log(distance/front)/log(back/front);
 return min(u32(floor(t*f32(CLUSTER_SLICES))),CLUSTER_SLICES-1u);
}
/** The clusters a sphere of \`radius\` around axis \`distance\` can reach: \`x\` the first, \`y\` one
 *  past the last, empty when \`x>=y\`. Conservative — it keeps a light that misses, never the
 *  reverse — because the sphere's axis span is at most its radius. */
fn clusterSliceSpan(distance:f32,radius:f32,front:f32,back:f32)->vec2u{
 let lo=distance-radius;
 let hi=distance+radius;
 if(hi<front||lo>back){return vec2u(0u,0u);}
 return vec2u(clusterSliceIndex(max(lo,front),front,back),clusterSliceIndex(min(hi,back),front,back)+1u);
}`;

/** Normalized depth to the slices' unit: `1 / z`, the view distance up to the camera's near-plane
 *  factor (`z = nearPlane / distance`). The slice index is a ratio of these, so that factor
 *  cancels and the resolve needs no near plane; the pass multiplies it back in where the light
 *  radius is compared (`clusterBins`). */
export const clusterDistanceWgsl = `
fn clusterDistance(z:f32)->f32{return ${DEPTH_NEAR}.0/max(z,1e-9);}`;

/** The cluster functions, shared by the tile pass and the resolve. */
export const CLUSTER_LEADING_WGSL = `${clusterDistanceWgsl}
${clusterSliceIndexWgsl}`;

/**
 * The wide tile pass's assignment, after its compaction: each of the tile's kept opaque lights is
 * binned into the clusters its sphere reaches, in increasing rank order, so every cluster list is
 * a subsequence of the tile's opaque list and the resolve's sum is develop's, bit for bit. The
 * bins live in the view's pool, one `(offset,count)` descriptor per slice in the tile record.
 *
 * A tile the pool cannot hold, one past its list, or one whose farthest surface is the
 * background, keeps its whole opaque list: the flag word stays zero and the resolve falls back to
 * `tileLighting`, exact as before. The pass never drops a light. `base`, `lane`, the workgroup
 * depth atomics and the pool are those of the tile pass (`./shader.ts`).
 */
export const clusterBinsWgsl = `
/** Per-slice kept counts, filled by one lane each, then prefix-summed by thread zero. */
var<workgroup> sliceCount:array<u32,CLUSTER_SLICES>;
var<workgroup> sliceStart:array<u32,CLUSTER_SLICES>;
/** The centre ray of the tile pass's frame, pointing away from the eye: the view axis the slices
 *  are measured along. Reversed depth, so the near plane has the greater depth value. */
fn clusterForward()->vec3f{
 let near=unproject(vec3f(0.0,0.0,${DEPTH_NEAR}.0));
 let deep=unproject(vec3f(0.0,0.0,COLUMN_DEPTH));
 return normalize(deep-near);
}
/** The near-plane distance of the camera the pass's inverse view-projection carries: the length of
 *  the centre ray's near point, in the pass's frame (the eye at its origin). The light radius is a
 *  length in metres, so the pass measures in metres; the resolve's ratio never needs this. */
fn clusterNear()->f32{return length(unproject(vec3f(0.0,0.0,${DEPTH_NEAR}.0)));}
/** Whether light \`i\` of the tile's opaque list reaches slice \`slice\`. The sun has no range: it
 *  reaches every slice. */
fn clusterLightReaches(base:u32,index:u32,slice:u32,forward:vec3f,frontD:f32,backD:f32)->bool{
 let light=lights.items[tiles[base+TILE_OPAQUE_BASE+index]];
 if(isSun(light)){return true;}
 let reach=clusterSliceSpan(dot(light.positionRange.xyz-view.origin.xyz,forward),light.positionRange.w,frontD,backD);
 return slice>=reach.x&&slice<reach.y;
}
/** Writes the record's depth words and cluster flag, and (when there is room) the bins. Runs after
 *  the tile compaction, in uniform control flow: every lane reaches each barrier. */
fn clusterBins(base:u32,lane:u32){
 let kept=tiles[base];
 tiles[base+TILE_DEPTH_BASE]=atomicLoad(&nearest);
 tiles[base+TILE_DEPTH_BASE+1u]=atomicLoad(&farthest);
 if(lane==0u){tiles[base+TILE_CLUSTER_FLAG]=0u;}
 if(lane<CLUSTER_SLICES){sliceCount[lane]=0u;}
 workgroupBarrier();
 let on=kept>0u&&kept<=TILE_LIGHTS&&bitcast<f32>(atomicLoad(&farthest))>0.0;
 var forward=vec3f(0.0,0.0,1.0);
 var frontD=0.0;
 var backD=0.0;
 if(on){
  forward=clusterForward();
  let nearPlane=clusterNear();
  // The light radius is metres: the pass measures in metres too, the near factor put back in.
  frontD=nearPlane*clusterDistance(bitcast<f32>(atomicLoad(&nearest)));
  backD=nearPlane*clusterDistance(bitcast<f32>(atomicLoad(&farthest)));
  if(lane<CLUSTER_SLICES){
   var count=0u;
   for(var i=0u;i<kept;i++){
    if(clusterLightReaches(base,i,lane,forward,frontD,backD)){count=count+1u;}
   }
   sliceCount[lane]=count;
  }
 }
 workgroupBarrier();
 if(lane==0u&&on){
  var total=0u;
  for(var s=0u;s<CLUSTER_SLICES;s++){sliceStart[s]=total;total=total+sliceCount[s];}
  var at=0xffffffffu;
  if(atomicLoad(&pool.head)<0x80000000u){at=atomicAdd(&pool.head,total);}
  if(at<pool.capacity&&total<=pool.capacity-at){
   for(var s=0u;s<CLUSTER_SLICES;s++){
    tiles[base+TILE_CLUSTER_BASE+2u*s]=sliceStart[s]+pool.start;
    tiles[base+TILE_CLUSTER_BASE+2u*s+1u]=sliceCount[s];
   }
   tiles[base+TILE_CLUSTER_FLAG]=1u;
  }
 }
 workgroupBarrier();
 if(tiles[base+TILE_CLUSTER_FLAG]!=0u&&lane<CLUSTER_SLICES){
  var at=tiles[base+TILE_CLUSTER_BASE+2u*lane];
  for(var i=0u;i<kept;i++){
   if(clusterLightReaches(base,i,lane,forward,frontD,backD)){
    tiles[at]=tiles[base+TILE_OPAQUE_BASE+i];
    at=at+1u;
   }
  }
 }
}`;

/** The resolve's slice: the pixel's own cluster descriptor, then the lights assigned to it. */
export const clusterResolveWgsl = `
/** Lighting of a pixel from its cluster alone: the tile list, cut by depth, so it pays for no
 *  light that cannot reach it. The tile's flag is read once; a tile that kept its whole list
 *  (too many lights, no pool room) takes the full opaque sum, character for character. */
fn clusterLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,pixel:vec2f)->vec3f{
 let tile=pixelTile(pixel);
 let tilesX=u32(view.lightParams.y);
 let base=(tile.y*tilesX+tile.x)*TILE_STRIDE;
 if(tileLights[base+TILE_CLUSTER_FLAG]==0u){return tileLighting(rgb,metal,rough,N,V,P,ao,tile,tilesX,0u,TILE_OPAQUE_BASE);}
 let z=textureLoad(depth,vec2i(pixel),0);
 if(z<=0.0){return vec3f(0.0);}
 // The slice index is a ratio of view distances: the tiles' normalized depths serve as they are.
 let front=clusterDistance(bitcast<f32>(tileLights[base+TILE_DEPTH_BASE]));
 let back=clusterDistance(bitcast<f32>(tileLights[base+TILE_DEPTH_BASE+1u]));
 let slice=clusterSliceIndex(clusterDistance(z),front,back);
 let first=tileLights[base+TILE_CLUSTER_BASE+2u*slice];
 let count=tileLights[base+TILE_CLUSTER_BASE+2u*slice+1u];
 var result=vec3f(0.0);
 for(var index=0u;index<count;index++){
  result+=declaredLight(directLights.items[tileLights[first+index]],rgb,metal,rough,N,V,P,ao);
 }
 return result;
}`;

/** The tile pass's addition: the cluster functions and the binning, wide path only. */
export const clusterPassWgsl = () => `${CLUSTER_LEADING_WGSL}
${clusterBinsWgsl}`;

/** Slices, exposed for tests and for the documentation of the setting. */
export const CLUSTER_SLICES = LIGHT_SETTINGS.clusterSlices;
