import { BLOOM_DOWN_TAPS, BLOOM_UP_TAPS, bloomTapText } from './bloomFilter.ts';

const read = (offset: string) => `texture(level,uv+${offset}*stride)`;

/** What the three bloom programs share: the level read with bilinear filtering, the inverse
 *  sizes written (`targetTexel`) and read (`sourceTexel`), the tent. */
const HEAD = `#version 300 es
precision highp float;precision highp sampler2D;uniform sampler2D level,scene;uniform vec2 targetTexel,sourceTexel;
uniform float radius,keep,glow;out vec4 color;
vec4 tent(vec2 uv){vec2 stride=sourceTexel*radius;vec4 c=vec4(0.0);
${bloomTapText(BLOOM_UP_TAPS, read, 'vec2')}
return c;}
`;

/**
 * The bloom's three WebGL2 programs, the same filters as `bloomWgsl.ts` from the same taps
 * (`bloomFilter.ts`), on premultiplied linear radiance: `down` filters the level above into this
 * one, `up` adds the level below into this one (additive blending), `composite` blends the first
 * level's sum into the image.
 */
export const BLOOM_GLSL = {
  down: `${HEAD}void main(){vec2 uv=gl_FragCoord.xy*targetTexel;vec2 stride=sourceTexel;vec4 c=vec4(0.0);
${bloomTapText(BLOOM_DOWN_TAPS, read, 'vec2')}
color=c;}`,
  up: `${HEAD}void main(){color=tent(gl_FragCoord.xy*targetTexel);}`,
  composite: `${HEAD}void main(){
color=texelFetch(scene,ivec2(gl_FragCoord.xy),0)*keep+tent(gl_FragCoord.xy*targetTexel)*glow;}`,
};
