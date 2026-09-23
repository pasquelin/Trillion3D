import {
  DEFAULT_TONE_MAPPING,
  TONE_MAPPING_RANK,
} from '../../../packages/sdk-core/src/scene/core/environment.ts';
import type { HostDrawOutput } from '../../../packages/sdk-browser/src/backend/types.ts';
import type { HostDrawCamera } from '../../../packages/sdk-browser/src/camera/world.ts';
import type { ObservationMeshes } from './meshes.ts';
import { createObservationProgram } from './program.ts';
import type { ObservationResources, ObservationTexture } from './resources.ts';
import { WebglClusterGeometry } from '../../../packages/sdk-browser/src/webgl/cluster/geometry.ts';
import { submitDiagnosticMesh } from '../../../packages/sdk-browser/src/webgl/cluster/submit.ts';

/** Texture unit of each float texture, in the order the fragment shader samples them. */
const SAMPLERS = ['indirectCache', 'surfaceData', 'bvhData'] as const;

/** One engine-owned pass of the observation: the program, its three float textures and the
 *  geometry cache, rebuilt whole after a context restore — its first draw uploads every
 *  texture. */
class ObservationPass {
  private gl: WebGL2RenderingContext;
  private resources: ObservationResources;
  private meshes: ObservationMeshes;
  private program: WebGLProgram;
  private geometry: WebglClusterGeometry;
  private textures: WebGLTexture[] = [];
  /** Texels of each unit, in `SAMPLERS` order. */
  private sources: readonly ObservationTexture[];
  private fresh = true;
  private locations = new Map<string, WebGLUniformLocation | null>();
  private model = new Float32Array(16);
  private view = new Float32Array(16);
  constructor(
    gl: WebGL2RenderingContext,
    resources: ObservationResources,
    meshes: ObservationMeshes,
  ) {
    this.gl = gl;
    this.resources = resources;
    this.meshes = meshes;
    this.sources = [resources.texture, resources.surfaceTexture, resources.bvhTexture];
    this.program = createObservationProgram(gl, resources.surfaceCount);
    this.geometry = new WebglClusterGeometry(gl, {
      position: gl.getAttribLocation(this.program, 'position'),
      normal: -1,
      uv: -1,
      uv1: -1,
      color: -1,
    });
    gl.useProgram(this.program);
    for (let unit = 0; unit < SAMPLERS.length; unit++) {
      gl.uniform1i(this.at(SAMPLERS[unit]), unit);
      const texture = gl.createTexture()!;
      this.textures.push(texture);
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, texture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }
  }
  private at(name: string) {
    if (!this.locations.has(name))
      this.locations.set(name, this.gl.getUniformLocation(this.program, name));
    return this.locations.get(name)!;
  }
  /** Binds the three textures on their units; a texture whose texels moved is uploaded whole. */
  private bindTextures() {
    const gl = this.gl;
    for (let unit = 0; unit < this.sources.length; unit++) {
      const source = this.sources[unit];
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, this.textures[unit]);
      if (!source.dirty && !this.fresh) continue;
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA32F,
        source.width,
        source.height,
        0,
        gl.RGBA,
        gl.FLOAT,
        source.data,
      );
      source.dirty = false;
    }
    this.fresh = false;
  }
  draw(camera: HostDrawCamera, toneMapped: boolean, toneCurve: number) {
    const gl = this.gl,
      { uniforms } = this.resources;
    gl.useProgram(this.program);
    this.bindTextures();
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.STENCIL_TEST);
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.depthMask(true);
    gl.colorMask(true, true, true, true);
    gl.frontFace(gl.CCW);
    this.view.set(camera.view);
    gl.uniformMatrix4fv(this.at('viewMatrix'), false, this.view);
    gl.uniformMatrix4fv(this.at('projectionMatrix'), false, camera.projection);
    gl.uniform3fv(this.at('cameraPosition'), camera.eye);
    gl.uniform1i(this.at('toneMapped'), toneMapped ? 1 : 0);
    gl.uniform1i(this.at('toneCurve'), toneCurve);
    gl.uniform2fv(this.at('cacheSize'), uniforms.cacheSize);
    gl.uniform4fv(this.at('sphere'), uniforms.sphere);
    gl.uniform1f(this.at('sphereRoughness'), uniforms.sphereRoughness);
    gl.uniform1i(this.at('reflectionSamples'), uniforms.reflectionSamples);
    gl.uniform1f(this.at('experimentExposure'), uniforms.experimentExposure);
    gl.uniform1i(this.at('emitterCount'), uniforms.emitterCount);
    gl.uniform1iv(this.at('emitterIndices'), uniforms.emitterIndices);
    gl.uniform1i(this.at('directLightSamples'), uniforms.directLightSamples);
    gl.uniform1i(this.at('directLightGrid'), uniforms.directLightGrid);
    gl.uniform1i(this.at('useBvh'), uniforms.useBvh ? 1 : 0);
    for (const copy of this.meshes.copies) {
      this.model.set(copy.matrix.elements);
      gl.uniformMatrix4fv(this.at('modelMatrix'), false, this.model);
      gl.uniform1i(this.at('primarySurface'), copy.surface);
      this.geometry.bind(copy.geometry);
      submitDiagnosticMesh(gl, copy);
    }
    gl.bindVertexArray(null);
  }
  dispose() {
    this.geometry.dispose();
    for (const texture of this.textures) this.gl.deleteTexture(texture);
    this.gl.deleteProgram(this.program);
  }
}

/**
 * `drawHostGeometry` of the transport experiment: the observed surfaces and the sphere, drawn
 * by the engine's program on the destination the composer bound and cleared. Without a
 * context (a session that never draws on the host surface) the draw is refused by name. After
 * a context restore the pass is rebuilt, textures included.
 */
export function createObservationDraw(
  gl: WebGL2RenderingContext | undefined,
  resources: ObservationResources,
  meshes: ObservationMeshes,
) {
  let pass: ObservationPass | undefined;
  const restored = () => {
    pass?.dispose();
    pass = undefined;
  };
  gl?.canvas.addEventListener('webglcontextrestored', restored);
  return {
    drawHostGeometry(camera: HostDrawCamera, output: HostDrawOutput) {
      if (!gl) throw new Error('HOST_SURFACE_MISSING');
      pass ??= new ObservationPass(gl, resources, meshes);
      pass.draw(
        camera,
        output.toneMapped,
        TONE_MAPPING_RANK[output.toneMapping ?? DEFAULT_TONE_MAPPING],
      );
    },
    dispose() {
      gl?.canvas.removeEventListener('webglcontextrestored', restored);
      pass?.dispose();
      pass = undefined;
    },
  };
}
