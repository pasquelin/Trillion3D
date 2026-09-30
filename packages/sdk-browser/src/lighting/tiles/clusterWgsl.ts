import { LIGHT_SETTINGS } from '../../../../sdk-core/src/index.ts';
import { DEPTH_NEAR } from '../../camera/depthConvention.ts';

/**
 * The light grid (#1249), the reference engine's froxels on the existing tiles: a tile's opaque slice is cut into
 * `CLUSTER_SLICES` logarithmically spaced slices along the view axis, and a pixel walks only the
 * lights of its own slice. A light is assigned to every slice its range sphere can reach, so the
 * walk holds every light that reaches the pixel and skips only lights that would have added an
 * exact zero there (`directIncidence`): the sum is develop's, term for term, without the zeros.
 *
 * The slice is a function of the **axis distance** (the view-space depth the projection measures),
 * not the Euclidean distance: for a pixel `p` and a light centre `c`, `|axis(p) − axis(c)|` is the
 * projection of `p − c` on the view axis, hence at most `|p − c|`. A light of radius `r` that
 * reaches a pixel at axis distance `d` therefore has its centre within `[d − r, d + r]`, the span
 * assigned here, padded by `CLUSTER_PAD` of its distance so that the pass's and the resolve's
 * roundings of one boundary never drop a light.
 */
export const clusterSliceIndexWgsl = `
/** A numerical margin, not a scene setting: a thousandth of the distance, far above the f32
 *  roundings of one slice boundary, far below a slice's width. */
const CLUSTER_PAD:f32=0.001;
/** Slice of an axis \`distance\`, in [0, CLUSTER_SLICES): logarithmic between the tile's nearest
 *  (\`front\`) and farthest (\`back\`) surface. A flat tile, or a point before its front, is the
 *  first slice; a point past its back the last. */
fn clusterSliceIndex(distance:f32,front:f32,back:f32)->u32{
 if(back<=front||distance<=front){return 0u;}
 if(distance>=back){return CLUSTER_SLICES-1u;}
 let t=log(distance/front)/log(back/front);
 return min(u32(floor(t*f32(CLUSTER_SLICES))),CLUSTER_SLICES-1u);
}
/** The slices a sphere of \`radius\` around axis \`distance\` can reach: \`x\` the first, \`y\` one
 *  past the last, empty when \`x>=y\`. Conservative — it keeps a light that misses, never the
 *  reverse — because the sphere's axis span is at most its radius. */
fn clusterSliceSpan(distance:f32,radius:f32,front:f32,back:f32)->vec2u{
 let pad=(abs(distance)+radius)*CLUSTER_PAD;
 let lo=distance-radius-pad;
 let hi=distance+radius+pad;
 if(hi<front||lo>back){return vec2u(0u,0u);}
 return vec2u(clusterSliceIndex(max(lo,front),front,back),clusterSliceIndex(min(hi,back),front,back)+1u);
}`;

/** Normalized depth to the slices' unit: `1 / z`, the view distance up to the camera's near-plane
 *  factor (`z = nearPlane / distance`). The slice index is a ratio of these, so that factor
 *  cancels and the resolve needs no near plane; the pass multiplies it back in where the light
 *  radius is compared (`clusterFrame`). */
const clusterDistanceWgsl = `
fn clusterDistance(z:f32)->f32{return ${DEPTH_NEAR}.0/max(z,1e-9);}`;

/** Lanes of the tile pass per slice, and the mask bits each one settles: 256 lanes, 64 bits. */
const PARTS = LIGHT_SETTINGS.tileSize ** 2 / LIGHT_SETTINGS.clusterSlices;
const PART_BITS = 64 / PARTS;
const PART_SHIFT = Math.log2(PARTS);

/**
 * The tile pass's grid, after its compaction, in uniform control flow — no atomic, no pool, no
 * copy of the list. Lane `l` settles slice `l / PARTS`, mask bits `PART_BITS` from
 * `(l % PARTS) * PART_BITS`: for each light of those bits' runs (`clusterShift`) it tests the
 * sphere's span once. Lanes `2 * CLUSTER_SLICES` then gather the bits into the record's words. The
 * walked slice is the resolve's own (`tileSlice`): the list, the pool past it, or every light.
 * A tile whose farthest surface is the background, or one with no light, writes full masks: its
 * pixels walk the whole slice, exact as before. `base`, `lane`, `count`, the workgroup depth
 * atomics and `unproject` are the tile pass's (`./shader.ts`, `./boundsWgsl.ts`).
 */
const clusterMasksWgsl = `
const CLUSTER_PARTS:u32=${PARTS}u;
const CLUSTER_PART_BITS:u32=${PART_BITS}u;
const CLUSTER_PART_SHIFT:u32=${PART_SHIFT}u;
/** The kept count, the view axis and the tile's front and back distances, thread zero's. */
var<workgroup> clusterKept:u32;
var<workgroup> clusterAxis:vec3f;
var<workgroup> clusterFront:f32;
var<workgroup> clusterBack:f32;
/** Each lane's settled bits, gathered into the record once every lane has written. */
var<workgroup> clusterBits:array<u32,${LIGHT_SETTINGS.tileSize ** 2}>;
/** The view axis, pointing away from the eye: the normal of the near plane, the axis the depth
 *  buffer measures along. A jittered matrix shifts the plane's points, never its normal. */
fn clusterForward()->vec3f{
 let centre=unproject(vec3f(0.0,0.0,${DEPTH_NEAR}.0));
 let normal=normalize(cross(unproject(vec3f(1.0,0.0,${DEPTH_NEAR}.0))-centre,unproject(vec3f(0.0,1.0,${DEPTH_NEAR}.0))-centre));
 return select(-normal,normal,dot(normal,unproject(vec3f(0.0,0.0,COLUMN_DEPTH))-centre)>0.0);
}
/** Thread zero: the axis and the front and back distances in metres. The light radius is a
 *  length, so the near plane's offset along the axis goes back into the normalized depths. */
fn clusterFrame(nearZ:u32,farZ:u32){
 clusterAxis=clusterForward();
 let nearPlane=dot(unproject(vec3f(0.0,0.0,${DEPTH_NEAR}.0)),clusterAxis);
 clusterFront=nearPlane*clusterDistance(bitcast<f32>(nearZ));
 clusterBack=nearPlane*clusterDistance(bitcast<f32>(farZ));
}
/** The light at \`index\` of the walked slice: the list, its pool room past it, or the scene. */
fn clusterListed(base:u32,kept:u32,index:u32)->u32{
 if(kept<=TILE_LIGHTS){return tiles[base+TILE_OPAQUE_BASE+index];}
 let first=tiles[base+TILE_OPAQUE_BASE];
 if(first==TILE_NO_SLICE){return index;}
 return tiles[first+index];
}
/** Whether a light can reach slice \`slice\`. The sun has no range: it reaches every slice. */
fn clusterReaches(light:u32,slice:u32)->bool{
 let item=lights.items[light];
 if(isSun(item)){return true;}
 let reach=clusterSliceSpan(dot(item.positionRange.xyz-view.origin.xyz,clusterAxis),item.positionRange.w,clusterFront,clusterBack);
 return slice>=reach.x&&slice<reach.y;
}
/** Lane \`lane\`'s bits: bit \`b\` when a light of group \`first + b\` of the \`walked\` lights
 *  reaches the lane's slice. */
fn clusterPartBits(base:u32,kept:u32,walked:u32,lane:u32)->u32{
 let slice=lane>>CLUSTER_PART_SHIFT;
 let first=(lane%CLUSTER_PARTS)*CLUSTER_PART_BITS;
 let group=1u<<clusterShift(walked);
 var bits=0u;
 for(var bit=0u;bit<CLUSTER_PART_BITS;bit++){
  let end=min((first+bit+1u)*group,walked);
  for(var index=(first+bit)*group;index<end;index++){
   if(clusterReaches(clusterListed(base,kept,index),slice)){bits|=1u<<bit;break;}
  }
 }
 return bits;
}
/** Mask word \`word\` of the record (slice \`word / 2\`), from the lanes' bits. */
fn clusterWord(word:u32)->u32{
 let lanes=32u/CLUSTER_PART_BITS;
 let first=(word>>1u)*CLUSTER_PARTS+(word%2u)*lanes;
 var mask=0u;
 for(var part=0u;part<lanes;part++){mask|=clusterBits[first+part]<<(part*CLUSTER_PART_BITS);}
 return mask;
}
fn clusterMasks(base:u32,lane:u32,count:u32){
 // The compaction's list and pool writes, made by every lane, land before any lane reads them.
 storageBarrier();
 if(lane==0u){clusterKept=tiles[base];}
 let kept=workgroupUniformLoad(&clusterKept);
 let on=kept>0u&&bitcast<f32>(atomicLoad(&farthest))>0.0;
 if(lane==0u){
  tiles[base+TILE_DEPTH_BASE]=select(0u,atomicLoad(&nearest),on);
  tiles[base+TILE_DEPTH_BASE+1u]=select(0u,atomicLoad(&farthest),on);
  if(on){clusterFrame(atomicLoad(&nearest),atomicLoad(&farthest));}
 }
 workgroupBarrier();
 var bits=0xffffffffu;
 if(on){
  var walked=kept;
  if(kept>TILE_LIGHTS&&tiles[base+TILE_OPAQUE_BASE]==TILE_NO_SLICE){walked=count;}
  bits=clusterPartBits(base,kept,walked,lane);
 }
 clusterBits[lane]=bits;
 workgroupBarrier();
 if(lane<2u*CLUSTER_SLICES){tiles[base+TILE_CLUSTER_BASE+lane]=select(0xffffffffu,clusterWord(lane),on);}
}`;

/** The tile pass's addition: the grid functions and the masks, in both passes. */
export const clusterPassWgsl = `${clusterDistanceWgsl}
${clusterSliceIndexWgsl}
${clusterMasksWgsl}`;

/** The resolve's side: the pixel's slice mask, and the lighting of its tile's opaque slice. */
export const clusterResolveWgsl = `${clusterDistanceWgsl}
${clusterSliceIndexWgsl}
/** The pixel's slice mask: its depth, between the tile's nearest and farthest, picks the slice.
 *  A tile the pass kept whole reads front and back zero, one slice, full masks. */
fn clusterMask(base:u32,pixel:vec2f)->vec2u{
 // The slice index is a ratio of view distances: the tiles' normalized depths serve as they are.
 let front=clusterDistance(bitcast<f32>(tileLights[base+TILE_DEPTH_BASE]));
 let back=clusterDistance(bitcast<f32>(tileLights[base+TILE_DEPTH_BASE+1u]));
 let slice=clusterSliceIndex(clusterDistance(textureLoad(depth,vec2i(pixel),0)),front,back);
 return vec2u(tileLights[base+TILE_CLUSTER_BASE+2u*slice],tileLights[base+TILE_CLUSTER_BASE+2u*slice+1u]);
}
/** Lighting of a pixel from its slice of the grid alone: the tile's opaque lights, those the
 *  pixel's slice mask names. */
fn clusterLighting(rgb:vec3f,metal:f32,rough:f32,N:vec3f,V:vec3f,P:vec3f,ao:f32,tile:vec2u,tilesX:u32,pixel:vec2f)->vec3f{
 let base=(tile.y*tilesX+tile.x)*TILE_STRIDE;
 return sliceLighting(rgb,metal,rough,N,V,P,ao,tileSlice(base,0u,TILE_OPAQUE_BASE),clusterMask(base,pixel));
}`;

/** Slices, exposed for tests and for the documentation of the setting. */
export const CLUSTER_SLICES = LIGHT_SETTINGS.clusterSlices;
