import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * The resolve's fragment entry (`shadeWgsl.ts`): the pixel's class admitted, its surfaces shaded
 * (`shadeSurface`), then its two storage writes, each texel written once with its final value —
 * its thin transmission, its shadow receiver's offset and plane. Private, so zero at each pixel's
 * start: a path that finds none leaves zero, as a cleared texel holds.
 */
export const SHADE_ENTRY_WGSL = wgslBlock(
  'SHADE_ENTRY_WGSL',
  [],
  `var<private> thinOut:vec3f;
var<private> rcvOffset:vec3f;
var<private> rcvPlane:vec3f;
@fragment fn shade_fs(@builtin(position) pos:vec4f)->SurfaceOut{
 let id=textureLoad(vis,vec2<i32>(i32(pos.x),i32(pos.y)),0).r;
 // The background, a page past the table and another class are rejected before any write.
 if(!classAdmits(id)){discard;}
 let surface=shadeSurface(pos,id);
 storeSubsurface(pos.xy,thinOut);
 storeReceiver(pos.xy,rcvOffset,rcvPlane);
 return surface;
}`,
)
