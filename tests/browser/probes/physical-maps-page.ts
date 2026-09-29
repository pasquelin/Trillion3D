import { createWebglProgram } from '../../../packages/sdk-browser/src/webgl/core/program.ts';
import { FULLSCREEN_VERTEX } from '../../../packages/sdk-browser/src/webgl/core/fullscreenPass.ts';
import { createClusterProgram } from '../../../packages/sdk-browser/src/webgl/cluster/program.ts';
import { PHYSICAL_MAPS_GLSL } from '../../../packages/sdk-browser/src/webgl/cluster/physicalMapsShader.ts';
import { WebglClusterTextures } from '../../../packages/sdk-browser/src/webgl/cluster/textures.ts';
import { Matrix3UniformCache } from '../../../packages/sdk-browser/src/webgl/cluster/uniforms.ts';
import { importHostSurface } from '../../../packages/sdk-browser/src/host/surfaceImport.ts';
import * as G from '../../../packages/sdk-browser/src/host/graph/graph.fixture.ts';

export function run() {
  const gl = document.createElement('canvas').getContext('webgl2')!;
  if (!gl?.getExtension('EXT_color_buffer_float')) throw new Error('WebGL2 float unavailable');
  const cluster = createClusterProgram(gl);
  gl.deleteProgram(cluster);
  const program = createWebglProgram(
    gl,
    FULLSCREEN_VERTEX,
    `#version 300 es
precision highp float;precision highp int;
uniform highp sampler2D referenceMap;uniform int image;uniform float mipBias;
out vec4 color;
vec2 sourceUv(int channel){return gl_FragCoord.xy/vec2(16.0,8.0)*3.0-vec2(0.6);}
vec2 mapUv(mat3 transform,vec2 uv){return (transform*vec3(uv,1.0)).xy;}
${PHYSICAL_MAPS_GLSL}
void main(){vec2 uv=mapUv(physicalMapUv[image],sourceUv(0));
color=abs(physicalMap(image)-texture(referenceMap,uv,mipBias));}`,
  );
  gl.useProgram(program);
  const at = (name: string) => gl.getUniformLocation(program, name);
  gl.uniform1i(at('referenceMap'), 0);
  gl.uniform1i(at('physicalMaps'), 15);
  const first = G.dataTexture(
    Uint8Array.from([
      0, 10, 40, 255, 255, 100, 80, 255, 20, 220, 40, 255, 200, 80, 60, 255, 40, 40, 80, 255, 180,
      200, 120, 255,
    ]),
    3,
    2,
  );
  const second = G.dataTexture(
    Uint8Array.from([
      30, 200, 128, 255, 90, 100, 255, 255, 120, 180, 0, 255, 240, 0, 128, 255, 0, 255, 200, 255,
      128, 128, 255, 255,
    ]),
    2,
    3,
  );
  const surface = G.physicalSurface({
    anisotropy: 1,
    clearcoat: 1,
    anisotropyMap: first,
    clearcoatNormalMap: second,
  });
  const material = importHostSurface(surface)!;
  const textures = new WebglClusterTextures(gl);
  const matrices = new Matrix3UniformCache(gl, at);
  const output = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0 + 1);
  gl.bindTexture(gl.TEXTURE_2D, output);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 16, 8);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
  gl.viewport(0, 0, 16, 8);
  const errors: number[] = [];
  const differences: number[] = [];
  for (const filter of ['nearest', 'linear', 'linear-mip-linear'] as const) {
    for (const wrap of ['clamp', 'repeat', 'mirror'] as const) {
      for (const image of [0, 3]) {
        const map = image === 0 ? material.anisotropyMap! : material.clearcoatNormalMap!;
        const host = image === 0 ? first : second;
        host.minFilter =
          filter === 'nearest'
            ? G.HOST_FILTER_NEAREST
            : filter === 'linear'
              ? G.HOST_FILTER_LINEAR
              : G.HOST_FILTER_LINEAR_MIP_LINEAR;
        host.magFilter = filter === 'nearest' ? G.HOST_FILTER_NEAREST : G.HOST_FILTER_LINEAR;
        host.wrapS = host.wrapT =
          wrap === 'clamp'
            ? G.HOST_WRAP_CLAMP_TO_EDGE
            : wrap === 'repeat'
              ? G.HOST_WRAP_REPEAT
              : G.HOST_WRAP_MIRRORED_REPEAT;
        host.offset.set(0.125, 0);
        host.updateMatrix();
        textures.physical(surface, material, at, matrices);
        textures.bind(0, map, false);
        gl.uniform1i(at('image'), image);
        gl.drawArrays(gl.TRIANGLES, 0, 3);
        const values = new Float32Array(16 * 8 * 4);
        gl.readPixels(0, 0, 16, 8, gl.RGBA, gl.FLOAT, values);
        differences.push(Math.max(...values));
        errors.push(gl.getError());
      }
    }
  }
  textures.dispose();
  gl.deleteTexture(output);
  gl.deleteFramebuffer(framebuffer);
  gl.deleteProgram(program);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { differences, errors };
}
