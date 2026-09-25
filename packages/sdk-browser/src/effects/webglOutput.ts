import { FULLSCREEN_VERTEX } from '../webgl/core/fullscreenPass.ts';
import { OUTPUT_TRANSFER_GLSL } from '../webgl/core/outputGlsl.ts';
import { createWebglProgram } from '../webgl/core/program.ts';
import { createWebglRenderTarget, type WebglRenderTarget } from '../webgl/core/renderTarget.ts';

/**
 * The display chain's last links after the effects: premultiplied linear radiance over the
 * background, as the WebGPU composition writes it — an uncovered pixel is the background as it is,
 * a covered one its radiance through the scene's curve and the sRGB transfer, a partly covered one
 * the mix of the two by coverage. Coverage past one (an additive surface over a covered pixel)
 * adds light, not opacity: the radiance is read as a covered pixel's, never divided by it. The
 * curve spares the share of the coverage `untoned` marks: the surfaces whose material skips it
 * (`CLUSTER_LINEAR_FRAGMENT`). The scene's depth goes to the destination with the colour, so what
 * is drawn over the image after it (`world.guides`) is hidden behind the scene as it is without a
 * chain.
 */
const OUTPUT_FRAGMENT = `#version 300 es
precision highp float;precision highp sampler2D;uniform sampler2D image,untoned,depth;uniform bool toneMapped;
uniform vec3 background;out vec4 color;
${OUTPUT_TRANSFER_GLSL}
void main(){ivec2 at=ivec2(gl_FragCoord.xy);gl_FragDepth=texelFetch(depth,at,0).r;vec4 v=texelFetch(image,at,0);
if(v.a<=0.0){color=vec4(background,1.0);return;}
float a=min(v.a,1.0);vec3 c=v.rgb/a;
if(toneMapped)c=mix(toneMap(c),c,clamp(texelFetch(untoned,at,0).r/a,0.0,1.0));
color=vec4(linearToSrgb(c)*a+background*(1.0-a),1.0);}`;

/** What one display chain needs besides the passes: the curve and the encoded background. */
export type WebglEffectOutput = {
  toneMapped: boolean;
  /** Rank of the scene's curve (`TONE_MAPPING_RANK`). */
  toneCurve: number;
  /** The background, sRGB-encoded. */
  background: readonly [number, number, number];
};

/**
 * The target the engine draws the scene into for the chain: half-float radiance, a 24-bit depth
 * the output reads, and a second colour attachment, one byte a pixel, where the cluster program
 * marks the coverage of the surfaces the curve skips. All three are cleared together.
 */
export function createWebglSceneTarget(gl: WebGL2RenderingContext, w: number, h: number) {
  const target = createWebglRenderTarget(gl, w, h, { hdr: true, depth: false });
  /** A texture the size of the image, read texel for texel, attached at `attachment`. */
  const attach = (attachment: number, format: number, layout: number, type: number) => {
    const texture = gl.createTexture()!;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, format, w, h, 0, layout, type, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, target.framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, attachment, gl.TEXTURE_2D, texture, 0);
    return texture;
  };
  const untoned = attach(gl.COLOR_ATTACHMENT1, gl.R8, gl.RED, gl.UNSIGNED_BYTE),
    depth = attach(gl.DEPTH_ATTACHMENT, gl.DEPTH_COMPONENT24, gl.DEPTH_COMPONENT, gl.UNSIGNED_INT);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  return {
    target,
    untoned,
    depth,
    dispose() {
      gl.deleteTexture(untoned);
      gl.deleteTexture(depth);
      target.dispose();
    },
  };
}
export type WebglSceneTarget = ReturnType<typeof createWebglSceneTarget>;

/** The output program: draws `image`, the chain's last target, into the bound framebuffer. */
export function createWebglOutput(gl: WebGL2RenderingContext) {
  const program = createWebglProgram(gl, FULLSCREEN_VERTEX, OUTPUT_FRAGMENT);
  const at = (name: string) => gl.getUniformLocation(program, name);
  gl.useProgram(program);
  gl.uniform1i(at('image'), 0);
  gl.uniform1i(at('untoned'), 1);
  gl.uniform1i(at('depth'), 2);
  const [toneMapped, toneCurve, background] = ['toneMapped', 'toneCurve', 'background'].map(at);
  const read = (unit: number, texture: WebGLTexture) => {
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(gl.TEXTURE_2D, texture);
  };
  return {
    draw(image: WebglRenderTarget, scene: WebglSceneTarget, out: WebglEffectOutput) {
      gl.useProgram(program);
      gl.uniform1i(toneMapped, out.toneMapped ? 1 : 0);
      gl.uniform1i(toneCurve, out.toneCurve);
      gl.uniform3f(background, out.background[0], out.background[1], out.background[2]);
      read(2, scene.depth);
      read(1, scene.untoned);
      read(0, image.texture);
      // Every pixel takes the scene's depth, whatever the destination held.
      gl.enable(gl.DEPTH_TEST);
      gl.depthFunc(gl.ALWAYS);
      gl.depthMask(true);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose: () => gl.deleteProgram(program),
  };
}
