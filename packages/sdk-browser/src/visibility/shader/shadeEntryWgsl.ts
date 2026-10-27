import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * The resolve's compute entry (`shadeWgsl.ts`), a lane a pixel of its class's bin
 * (`binnedPixel`, `shadeBinsWgsl.ts`) — a lane with no pixel of its class to write, past the bin's
 * end or a quad's pixel of another class, does nothing (`shadesPixel`) —: the pixel's surfaces
 * shaded at its centre (`shadeSurface`, each marked with its object's page marks, `withPageMarks`), then its storage
 * writes, each texel written once with its final value — its thin transmission, its surfaces (`storeSurface`,
 * `shadeOutputsWgsl.ts`). The private variables are zero at each lane's start: a
 * path that finds none leaves zero, as a cleared texel holds.
 *
 * `SHADE_STAGE`, a diagnostic override (0, the whole kernel, folded to the code above), stops the kernel after a stage to time
 * the stages by difference: 1 after its binned pixel, 2 after its triangle's header and indices, 3 after its vertex fetch and
 * transform, 4 after its interpolation and derivatives (`shadeSurface`, `shadeWgsl.ts`, leaves its values in `shadeProbe`), 5 after
 * its material and surface. A stage writes nothing but `shadeSink`, which stores one word to the pixel's flags only when the
 * values reduced to it equal a constant no value is known to take, so the work the stage ends on is kept.
 */
export const SHADE_ENTRY_WGSL = wgslBlock(
  'SHADE_ENTRY_WGSL',
  [],
  `override SHADE_STAGE:u32=0u;
var<private> thinOut:vec3f;
var<private> thinOpacity:f32;
var<private> shadeProbe:u32;
fn shadeSink(at:vec2u,bits:u32){if(bits==0xDEADBEEFu){textureStore(wordsOut,at,0u,vec4u(bits,0u,0u,0u));}}
fn probeBits(a:vec4f)->u32{return bitcast<u32>(a.x+a.y+a.z+a.w);}
@compute @workgroup_size(SHADE_BIN_GROUP) fn shade_cs(@builtin(workgroup_id) group:vec3u,@builtin(num_workgroups) n:vec3u,@builtin(local_invocation_index) lane:u32){
 let at=binnedPixel(group,n,lane);
 if(!shadesPixel(at)){return;}
 let id=textureLoad(vis,vec2i(at.xy),0).r;
 if(SHADE_STAGE==1u){shadeSink(at.xy,id^at.z);return;}
 let surface=shadeSurface(vec4f(vec2f(at.xy)+0.5,0.0,1.0),id);
 if(SHADE_STAGE!=0u){
  shadeSink(at.xy,select(shadeProbe,probeBits(surface.baseMetal)^probeBits(surface.normalRough)^probeBits(surface.emissiveAo)^surface.flags^surface.request^bitcast<u32>(thinOut.x+thinOut.y+thinOut.z+thinOpacity),SHADE_STAGE==5u));
  return;
 }
 storeSubsurface(at.xy,thinOut,thinOpacity);
 storeSurface(at.xy,surface);
}`,
)
