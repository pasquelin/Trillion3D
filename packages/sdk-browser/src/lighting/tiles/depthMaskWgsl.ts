/**
 * The opaque slice's depth mask (#1369, the 2.5D culling of Harada's Forward+): the slab between
 * the tile's front and back depths is cut into `DEPTH_BINS` bins along the view axis, each covered
 * pixel sets the bit of its bin, and a light the slice keeps stays in the opaque list only if its
 * range sphere covers a set bin. A tile that holds a near column in front of a far wall lists the
 * lamps of the column and of the wall, never those that float in the empty depth between them.
 *
 * **Exact.** A light is dropped only when every pixel of the tile lies farther than its range along
 * the axis, hence in space: `directIncidence` and `rectView` give it an exact zero there, and the
 * resolve's sum loses a zero only. The bin of a depth `d` is one monotone function of `d`, so a
 * pixel in a bin the light's interval misses lies outside that interval; the interval is widened by
 * one bin at each end, which absorbs a bin function the compiler would round differently at the
 * pixel and at the light, and by `DEPTH_MARGIN` of the depths, far above the f32 roundings of the
 * pixel's unprojection. The axis is any unit direction for exactness — `|dot(a, P − c)| ≤ |P − c|`
 * —; the near plane's normal makes the bins slices of the view. An infinite range covers every bin.
 * `bench/oracles/browser/gpuLightTileDepthMaskOracle.ts` ports it.
 */
export const DEPTH_BINS = 32;
export const TILE_DEPTH_MASK_WGSL = `
const DEPTH_BINS:f32=${DEPTH_BINS}.0;
const DEPTH_MARGIN:f32=${2 ** -12};
/** One bit per depth bin a covered pixel of the tile falls in. */
var<workgroup> depthBins:atomic<u32>;
/** The bins' axis — the near plane's normal from the corner table —, the slab's first depth along
 *  it, the bins per unit of depth, and the slab's largest depth, which sizes the margin. Every
 *  thread derives it from the same corners, by the same operations. */
struct DepthAxis{along:vec3f,first:f32,scale:f32,reach:f32,}
fn depthAxis()->DepthAxis{
 let first=columnCorner(DEEP_ROW,0u);
 let along=normalize(cross(columnCorner(DEEP_ROW,1u)-first,columnCorner(DEEP_ROW,3u)-first));
 let front=dot(along,corners[FRONT_ROW*4u]);
 let back=dot(along,corners[BACK_ROW*4u]);
 return DepthAxis(along,min(front,back),DEPTH_BINS/max(abs(back-front),1e-20),max(abs(front),abs(back)));
}
/** The bin of depth \`d\`: monotone in \`d\`, clamped to the mask. */
fn depthBin(axis:DepthAxis,d:f32)->u32{return u32(clamp(floor((d-axis.first)*axis.scale),0.0,DEPTH_BINS-1.0));}
/** The bit of the pixel's bin: its centre at depth \`z\`, unprojected as the resolve's \`worldAt\`. */
fn pixelDepthBit(pixel:vec2u,z:f32)->u32{
 let axis=depthAxis();
 let at=vec2f(pixel)+0.5;
 return 1u<<depthBin(axis,dot(axis.along,unproject(vec3f(at.x/view.viewport.x*2.0-1.0,1.0-at.y/view.viewport.y*2.0,z))));
}
/** Whether the sphere of a light the opaque slice keeps covers a bin a pixel set: its interval
 *  along the axis, widened by the margin and by one bin at each end. */
fn depthBinsHit(centre:vec3f,radius:f32)->bool{
 let axis=depthAxis();
 let d=dot(axis.along,centre);
 let reach=radius+(abs(d)+axis.reach)*DEPTH_MARGIN;
 let lo=max(depthBin(axis,d-reach),1u)-1u;
 let hi=min(depthBin(axis,d+reach)+1u,${DEPTH_BINS - 1}u);
 return (atomicLoad(&depthBins)&(0xffffffffu>>(${DEPTH_BINS - 1}u-hi))&(0xffffffffu<<lo))!=0u;
}`;

/** The statements that fold the pixels' bins into the mask, every thread in uniform control flow:
 *  per subgroup first when the device granted \`subgroups\` — an OR is exact in any order. */
export const tileDepthBinsWgsl = (subgroups: boolean) => {
  const bit = ' let depthBit=select(0u,pixelDepthBit(pixel,z),covers);';
  return subgroups
    ? `${bit}
 let bins=subgroupOr(depthBit);
 if(subgroupElect()&&bins!=0u){atomicOr(&depthBins,bins);}`
    : `${bit}
 if(depthBit!=0u){atomicOr(&depthBins,depthBit);}`;
};
