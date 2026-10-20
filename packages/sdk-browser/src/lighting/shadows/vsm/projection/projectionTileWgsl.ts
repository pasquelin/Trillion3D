/**
 * The projection's tile pieces (`projectionWgsl.ts`): the region tests of a light at a pixel and at
 * a tile, the mask code, and the tile's box its lanes join.
 */
/** The light's region tests and the mask code (the receiver's trace: `../trace/receiverTraceWgsl.ts`). */
export const VSM_PROJECTION_REGION_WGSL = /* wgsl */ `/** The region test: whether light k shades the pixel at all (in the view rect, a lit surface,
 *  where the lighting gives the light energy — \`localLightReaches\` —, not back-facing). */
fn vsmLightParticipates(k:u32,info:VsmSurfaceInfo,shiftedPositionIn:vec3f)->bool{
 if(!info.valid){return false;}
 let light=vsmView.lights[k];
 let backfaceCull=!info.subsurface;
 if(vsmLightIsDirectional(light)){
  return !(backfaceCull&&vsmFacesAwayFromSun(info.worldNormal,light.direction,light.sourceRadius));
 }
 let toLight=light.shiftedPosition-shiftedPositionIn;
 if(!localLightReaches(toLight,light.radius,light.cosCone,-light.direction,light.kind==LIGHT_KIND_RECT)){return false;}
 return !(backfaceCull&&vsmFacesAwayFromLocal(toLight,info.worldNormal,light.sourceRadius));
}
/** \`vsmLightParticipates\`'s radius test widened: a light whose sphere is this much larger misses
 *  the tile's box. 1/64 past the roundings of either test (a few units in the last place). */
const VSM_TILE_REACH:f32=1.015625;
/**
 * Whether light k may shade a pixel of a tile whose lit pixels' points lie in the box [\`low\`,
 * \`high\`]: never false where \`vsmLightParticipates\` is true at one of those points. Every light
 * may reach a tile one of whose lit points is not finite (\`unbounded\`), whose test WGSL leaves
 * to the device, and a directional light any tile; a local light is tested on its sphere alone,
 * the cone and the faces left to the pixels. The box's nearest point is no farther from the
 * centre than any of its pixels, axis by axis: a subtraction is correctly rounded, hence
 * monotonic, so each axis's difference is at most the pixel's own, exactly; the squared distances
 * — a pixel's, against its range squared — and the box's square root then round within a few
 * units in the last place, which the reach's 1/64 holds many times over. A box whose squared
 * distance to the centre is under the smallest normal f32 (\`FLOAT32_MIN_NORMAL\`) holds it,
 * whatever the device does with subnormals.
 */
fn vsmLightMayReachTile(k:u32,low:vec3f,high:vec3f,unbounded:bool)->bool{
 let light=vsmView.lights[k];
 if(unbounded||vsmLightIsDirectional(light)){return true;}
 let c=light.shiftedPosition;
 let d=max(max(low-c,c-high),vec3f(0.0));
 let g=dot(d,d);
 return g<FLOAT32_MIN_NORMAL||sqrt(g)<=light.radius*VSM_TILE_REACH;
}
/** Light k's 8-bit lane: 0 where no ray was traced (its factor 1), else its rays n (high nibble,
 *  n ≤ 15) and the k of them that missed (low nibble), recovered exactly from k/n: the division's
 *  error times n ≤ 15 stays far under a half. Decoded by \`vsmMaskDecode\` (\`lighting/direct/shadowWgsl.ts\`). */
fn vsmMaskCode(r:VsmTraceResult)->u32{
 if(r.rayCount==0u){return 0u;}
 return (r.rayCount<<4u)|u32(round(r.shadowFactor*f32(r.rayCount)));
}
`

/**
 * The tile's box (`vsmLightMayReachTile`): each lit pixel's point, a coordinate's order kept by its
 * key (`vsmOrderedKey`), joined by the greatest key — and the greatest of the keys' complements,
 * whence the least — over the group; `vsmTileHeld` has bit 0 where a pixel is lit, bit 1 where one
 * of them is at a point not finite.
 */
export const VSM_PROJECTION_TILE_BOUND_WGSL = /* wgsl */ `
/** The tile's greatest keys of x, y and z, then of their complements. Zero-initialised by WebGPU,
 *  as are \`vsmTileHeld\` and the light words. */
var<workgroup> vsmTileBounds:array<atomic<u32>,6>;
var<workgroup> vsmTileHeld:atomic<u32>;
/** The lights that may reach the tile (\`vsmLightMayReachTile\`), 32 a word. */
var<workgroup> vsmTileCandidates:array<atomic<u32>,2>;
/** A float's key: its order as an unsigned integer (the sign bit set on a positive float, every
 *  bit flipped on a negative one), and back. */
fn vsmOrderedKey(x:vec3f)->vec3u{
 let u=bitcast<vec3u>(x);
 return select(u|vec3u(0x80000000u),~u,(u&vec3u(0x80000000u))!=vec3u(0u));
}
fn vsmOrderedValue(k:vec3u)->vec3f{
 return bitcast<vec3f>(select(~k,k&vec3u(0x7fffffffu),(k&vec3u(0x80000000u))!=vec3u(0u)));
}
/** Joins a pixel's point to the tile's box where it is lit (\`valid\`). Its \`held\` is 0, 1 or 3:
 *  their greatest is their union. */
fn vsmTileBound(valid:bool,p:vec3f){
 let finite=isFiniteWord(bitcast<u32>(p.x))&&isFiniteWord(bitcast<u32>(p.y))&&isFiniteWord(bitcast<u32>(p.z));
 var held=0u;var high=vec3u(0u);var low=vec3u(0u);
 if(valid){
  held=select(3u,1u,finite);
  if(finite){high=vsmOrderedKey(p);low=~high;}
 }
 if(held==0u){return;}
 atomicOr(&vsmTileHeld,held);
 for(var i=0u;i<3u;i++){atomicMax(&vsmTileBounds[i],high[i]);atomicMax(&vsmTileBounds[3u+i],low[i]);}
}
/** The lights 0 to \`count\` − 1, 32 a word (\`count\` ≤ 64). */
fn vsmLightsBelow(count:u32)->vec2u{
 let low=select(0xffffffffu,lowBits(count),count<32u);
 let high=select(select(0u,lowBits(count-32u),count>32u),0xffffffffu,count>=64u);
 return vec2u(low,high);
}
/** Lane k's light k, once every lane joined the box: a candidate of the tile where it may reach it. */
fn vsmTileCandidate(k:u32,lightCount:u32){
 let held=atomicLoad(&vsmTileHeld);
 if(k>=lightCount||held==0u){return;}
 var high=vec3u(0u);var low=vec3u(0u);
 for(var i=0u;i<3u;i++){high[i]=atomicLoad(&vsmTileBounds[i]);low[i]=~atomicLoad(&vsmTileBounds[3u+i]);}
 if(vsmLightMayReachTile(k,vsmOrderedValue(low),vsmOrderedValue(high),(held&2u)!=0u)){atomicOr(&vsmTileCandidates[bitWord(k)],bitMask(k));}
}
`
