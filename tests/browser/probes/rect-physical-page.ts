import {
  RECT_LIGHT_GLSL,
  createLtcTexture,
  LTC_UNIT,
} from '../../../packages/sdk-browser/src/webgl/cluster/rectGlsl.ts';
import { createWebglProgram } from '../../../packages/sdk-browser/src/webgl/core/program.ts';
import { FULLSCREEN_VERTEX } from '../../../packages/sdk-browser/src/webgl/core/fullscreenPass.ts';
import { createClusterProgram } from '../../../packages/sdk-browser/src/webgl/cluster/program.ts';

/** Executes rectangle lobes independently of material upload and tone mapping. */
export function run() {
  const canvas = document.createElement('canvas');
  const gl = canvas.getContext('webgl2')!;
  if (!gl?.getExtension('EXT_color_buffer_float')) throw new Error('Float WebGL2 unavailable');
  const cluster = createClusterProgram(gl);
  gl.deleteProgram(cluster);
  const output = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, output);
  gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA32F, 6, 1);
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, output, 0);
  const table = createLtcTexture(gl);
  const program = createWebglProgram(
    gl,
    FULLSCREEN_VERTEX,
    `#version 300 es
precision highp float;precision highp int;
const float PI=3.141592653589793;int surfaceModel=0;
vec3 thinSubsurface=vec3(0.0),anisotropyT=vec3(1.0,0.0,0.0),coatNormal=vec3(0.0,0.0,1.0);
vec4 physicalRead=vec4(0.0);float rangeWindow(float d,float r){return 1.0;}
vec3 modelLight(vec3 b,float m,vec3 n,vec3 l,float e,float ao){return vec3(0.0);}
${RECT_LIGHT_GLSL}
out vec4 color;void main(){int index=int(gl_FragCoord.x);
vec3 a=vec3(-1.5,-0.2,2.0),b=vec3(1.5,-0.2,2.0),c=vec3(1.5,0.2,2.0),d=vec3(-1.5,0.2,2.0);
vec3 N=vec3(0.0,0.0,1.0),V=normalize(vec3(0.3,0.0,1.0));
if(index==1||index==3)anisotropyT=vec3(0.0,1.0,0.0);
if(index<4){color=vec4(rectSpecular(a,b,c,d,N,V,vec3(0.04),0.4,index<2?0.0:0.8),1.0);return;}
physicalRead=vec4(0.0,0.0,1.0,index==4?0.15:0.8);vec3 coat;
rectLight(vec4(0.0,0.0,2.0,0.0),vec3(0.0,0.0,-1.0),vec4(1.5,0.0,0.0,0.2),vec4(1.0),N,V,vec3(0.0),vec3(0.0),1.0,0.4,1.0,coat);
color=vec4(coat,1.0);}`,
  );
  gl.useProgram(program);
  gl.uniform1i(gl.getUniformLocation(program, 'ltcTable'), LTC_UNIT);
  gl.viewport(0, 0, 6, 1);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  const values = new Float32Array(24);
  gl.readPixels(0, 0, 6, 1, gl.RGBA, gl.FLOAT, values);
  const error = gl.getError();
  gl.deleteProgram(program);
  gl.deleteTexture(table);
  gl.deleteTexture(output);
  gl.deleteFramebuffer(framebuffer);
  gl.getExtension('WEBGL_lose_context')?.loseContext();
  return { values: Array.from(values), error };
}
