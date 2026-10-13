import { LOBES_TARGET_WGSL } from '../../lighting/direct/lobesWgsl.ts'
import { VOLUME_LOBED, VOLUME_MARKED_WGSL } from '../transparent/transmission.ts'
import { wgslBlock } from '../../../../math/src/wgsl/decl.ts'

/**
 * The anisotropic and clear-coat lobes of a water pixel, in the composite's lobed programs
 * (`compositeWgsl.ts`, a key without `lobeless`): the lighting's one implementation
 * (`../../lighting/direct/lobesWgsl.ts`), on the texel the lobed surface stage left in the lobes
 * target (`surfaceWgsl.ts`) by the fragment that set the pixel's word. Read only where the volume
 * says its surface carries a lobe (`VOLUME_LOBED`) — a pixel of another surface finds there the
 * opaque resolve's lobes, or an earlier image's — and where that texel holds one; its coat normal is
 * turned with the normal the composite lights (`waterFacing`).
 *
 * Under the coat, as on a blend: each light (`lobeLight`, a dielectric's reflectance on the
 * specular's null albedo), the environment, the bounce and the transmitted backdrop, by what the
 * coat lets through (`lobeThrough`).
 */
export const WATER_LOBES_WGSL = wgslBlock(
  'WATER_LOBES_WGSL',
  [LOBES_TARGET_WGSL, VOLUME_MARKED_WGSL],
  `/** The lobes of the water pixel at \`coord\`, set for its lights (\`lobesAt\`, the opaque resolve's
 *  decode); \`side\` is -1 where the composite turned the stored normal to face the eye. */
fn waterLobes(vol:Volume,coord:vec2i,N:vec3f,V:vec3f,rough:f32,side:f32){
 if(!volumeMarked(vol,${VOLUME_LOBED}u)){return;}
 let w=textureLoad(physicalLobes,coord);
 if(w.z==0u){return;}
 lobesAt(w,side,N,V,rough);
}`,
)

/** The composite's lobeless programs: no lobe is read. */
export const WATER_LOBELESS_WGSL = wgslBlock(
  'WATER_LOBELESS_WGSL',
  [],
  'fn waterLobes(vol:Volume,coord:vec2i,N:vec3f,V:vec3f,rough:f32,side:f32){}',
)
