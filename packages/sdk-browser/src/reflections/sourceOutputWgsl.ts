import {
  CAMERA_FOG_WGSL,
  LIGHT_SURFACE_ENTRY,
  MIRROR_TERM_WGSL,
} from '../lighting/deferred/surfaceWgsl.ts'

const HELD = 'reflectionSourceRgb=rgb;reflectionSourceHeld=true;'

/**
 * The one lighting pass of a reflecting image writes, beside the lit image, the colour the next
 * image's reflections read (`source.ts`): the same radiance before camera fog and without the
 * mirror term, as the source always was; the lit image is the same sum, the mirror added last. A
 * pixel the body returns without such a colour (unlit, as-is) keeps its lit value there. Nothing
 * drawn after the lighting (transparents, water, particles) reaches it.
 */
export function withReflectionSourceOutput(shader: string) {
  if (!shader.includes(LIGHT_SURFACE_ENTRY) || !shader.includes(CAMERA_FOG_WGSL + '\n'))
    throw new Error('REFLECTION_SOURCE_OUTPUT_UNMATCHED')
  const lit = shader
    .replace(LIGHT_SURFACE_ENTRY, 'fn litSurface(pixel:vec4f)->vec4f{')
    .replaceAll(CAMERA_FOG_WGSL, HELD + CAMERA_FOG_WGSL)
    .replaceAll(`${MIRROR_TERM_WGSL};${HELD}`, `;${HELD}rgb+=${MIRROR_TERM_WGSL.slice(1)};`)
  // A mirror term left in the held sum would reflect itself: its text moved, the output refuses.
  if (lit.includes(`${MIRROR_TERM_WGSL};`)) throw new Error('REFLECTION_SOURCE_OUTPUT_UNMATCHED')
  return `${lit}
var<private> reflectionSourceRgb:vec3f;
var<private> reflectionSourceHeld:bool;
struct LitSurface{@location(0) lit:vec4f,@location(1) source:vec4f,}
${LIGHT_SURFACE_ENTRY.replace('->@location(0) vec4f{', '->LitSurface{')}
 reflectionSourceHeld=false;
 let color=litSurface(pixel);
 return LitSurface(color,select(color,vec4f(reflectionSourceRgb,1.0),reflectionSourceHeld));
}`
}
