import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * The resolve's compute entry (`shadeWgsl.ts`), a lane a pixel of its class's bin
 * (`binnedPixel`, `shadeBinsWgsl.ts`) — a lane with no pixel of its class to write, past the bin's
 * end or a quad's pixel of another class, does nothing (`shadesPixel`) —: the pixel's surfaces
 * shaded at its centre (`shadeSurface`), then its storage writes, each texel written once with its
 * final value — its thin transmission, its shadow receiver's offset and plane, its surfaces
 * (`storeSurface`, `shadeOutputsWgsl.ts`). The private variables are zero at each lane's start: a
 * path that finds none leaves zero, as a cleared texel holds.
 */
export const SHADE_ENTRY_WGSL = wgslBlock(
  'SHADE_ENTRY_WGSL',
  [],
  `var<private> thinOut:vec3f;
var<private> rcvOffset:vec3f;
var<private> rcvPlane:vec3f;
@compute @workgroup_size(SHADE_BIN_GROUP) fn shade_cs(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let at=binnedPixel(group,n,lane);
 if(!shadesPixel(at)){return;}
 let surface=shadeSurface(vec4f(vec2f(at.xy)+0.5,0.0,1.0),textureLoad(vis,vec2i(at.xy),0).r);
 storeSubsurface(at.xy,thinOut);
 storeReceiver(at.xy,rcvOffset,rcvPlane);
 storeSurface(at.xy,surface);
}`,
)
