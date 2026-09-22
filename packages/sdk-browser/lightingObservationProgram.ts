import { fragmentShader, vertexShader } from './lightingObservationShaders.ts';
import { OUTPUT_TRANSFER_GLSL } from './webglOutputGlsl.ts';
import { createWebglProgram } from './webglProgram.ts';

/**
 * The observation shaders as an engine program. The GLSL is the experiment's own, written in
 * the 1.00 dialect a host shader material accepts; the engine gives it the 3.00 profile the
 * context compiles — the attribute, the matrices and the eye it declared implicitly — and the
 * display chain in place of the two host includes: the scene's display curve when the frame is
 * tone mapped, then the sRGB transfer, the same links as the cluster program's.
 */
const VERTEX_PREFIX = `#version 300 es
precision highp float;
#define varying out
in vec3 position;
uniform mat4 modelMatrix,viewMatrix,projectionMatrix;
`;
const FRAGMENT_PREFIX = `#version 300 es
precision highp float;precision highp int;precision highp sampler2D;
#define varying in
#define texture2D texture
layout(location=0) out highp vec4 pc_fragColor;
#define gl_FragColor pc_fragColor
uniform vec3 cameraPosition;uniform bool toneMapped;
${OUTPUT_TRANSFER_GLSL}
`;
const TONE_MAPPING = 'if(toneMapped)gl_FragColor.rgb=toneMap(gl_FragColor.rgb);';
const COLOUR_SPACE = 'gl_FragColor.rgb=linearToSrgb(gl_FragColor.rgb);';

/** The two sources, as compiled; exported for the tests that read them without a context. */
export function observationSources(surfaceCount: number) {
  const fragment = fragmentShader(surfaceCount)
    .replace('#include <tonemapping_fragment>', TONE_MAPPING)
    .replace('#include <colorspace_fragment>', COLOUR_SPACE);
  if (fragment.includes('#include'))
    throw new Error('Observation shader keeps a host include the engine does not provide');
  return { vertex: VERTEX_PREFIX + vertexShader, fragment: FRAGMENT_PREFIX + fragment };
}

export function createObservationProgram(gl: WebGL2RenderingContext, surfaceCount: number) {
  const { vertex, fragment } = observationSources(surfaceCount);
  return createWebglProgram(gl, vertex, fragment);
}
