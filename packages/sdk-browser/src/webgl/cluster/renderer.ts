import { capture, receivers, target } from '../../reflections/captureGl.ts';
import type { ClusterDrawMesh, WholeMesh } from '../../cluster/batchMesh.ts';
import { WebglClusterGeometry } from './geometry.ts';
import { WebglClusterTextures } from './textures.ts';
import { unsupportedClusterLight, WebglClusterLights, type WebglClusterScene } from './lights.ts';
import { WebglClusterState } from './state.ts';
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/index.ts';
import type { HostDrawCamera } from '../../camera/world.ts';
import { Matrix3UniformCache, setClusterSamplers } from './uniforms.ts';
import { WebglClusterMaterialUniforms } from './materialUniforms.ts';
import { createClusterProgram } from './program.ts';
import { ClusterMeshValidation, type ReadDegraded } from './validation.ts';
import { WebglClusterBackdrop } from './backdrop.ts';
import { BACKDROP_UNITS, ClusterMaterialPass } from './materialBinding.ts';
import { refuseCluster } from './refusal.ts';
import { WebglClusterCopies, type SceneCopy } from './copyCulling.ts';
import { WebglClusterSubmission } from './submission.ts';

export class WebglClusterRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private geometry: WebglClusterGeometry;
  readonly textures: WebglClusterTextures;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private lights: WebglClusterLights;
  private state: WebglClusterState;
  private validation = new ClusterMeshValidation();
  private submission: WebglClusterSubmission;
  private backdrop: WebglClusterBackdrop;
  private reflection: WebglClusterBackdrop;
  private copies = new WebglClusterCopies<SceneCopy>();
  copySubmissions = 0;
  backdropSubmissions = 0;
  backdropPasses = 0;
  toneCurve: number = TONE_MAPPING_RANK.aces;
  readonly pass: ClusterMaterialPass;
  private readonly display: WebglClusterRenderer | undefined;
  private readonly locations: Record<string, number>;
  constructor(gl: WebGL2RenderingContext, display?: WebglClusterRenderer) {
    this.gl = gl;
    this.display = display;
    const program = (this.program = createClusterProgram(gl, display?.locations));
    this.locations = display?.locations ?? {};
    if (!display)
      for (const name of ['position', 'normal', 'uv', 'uv1', 'color', 'instanceMatrix'])
        this.locations[name] = gl.getAttribLocation(program, name);
    this.geometry = display?.geometry ?? new WebglClusterGeometry(gl, this.locations);
    this.textures = display?.textures ?? new WebglClusterTextures(gl);
    this.lights = new WebglClusterLights(gl, this.program);
    this.state = display?.state ?? new WebglClusterState(gl);
    this.backdrop = display?.backdrop ?? new WebglClusterBackdrop(gl, BACKDROP_UNITS);
    this.reflection = display?.reflection ?? target(gl);
    this.pass = new ClusterMaterialPass({
      uniforms: new WebglClusterMaterialUniforms(gl, (name) => this.at(name)),
      matrices: new Matrix3UniformCache(gl, (name) => this.at(name)),
      textures: this.textures,
      state: this.state,
      linear: !!display,
    });
    gl.useProgram(program);
    setClusterSamplers(gl, (name) => this.at(name));
    const parts = { geometry: this.geometry, lists: this.lights.lists, state: this.state };
    this.submission = new WebglClusterSubmission(gl, { ...parts, pass: this.pass }, (name) =>
      this.at(name),
    );
  }
  /** Triangles the frame submitted, every pass included. */
  get triangles() {
    return this.submission.triangles;
  }
  get backdropBytes() {
    return this.backdrop.bytes + this.reflection.bytes;
  }
  private at(name: string) {
    if (!this.uniforms.has(name))
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }
  private setOutput(srgbDestination: boolean) {
    this.gl.uniform1i(this.at('srgbDestination'), srgbDestination ? 1 : 0);
    this.state.invalidate();
    this.pass.forget();
    this.submission.forget(); // the winding goes with the raster state
  }
  draw(
    meshes: readonly ClusterDrawMesh[],
    scene: WebglClusterScene,
    camera: HostDrawCamera,
    toneMapped: boolean,
    srgbDestination: boolean,
    diagnosticMeshes: readonly WholeMesh[] = [],
    copies: readonly SceneCopy[] = [],
    degraded?: ReadDegraded,
  ) {
    const gl = this.gl,
      lightReason = unsupportedClusterLight(scene);
    if (lightReason) refuseCluster(lightReason);
    this.copies.cull(copies, camera);
    const { plain, blended, transmissive } = this.copies;
    this.validation.validate(meshes, diagnosticMeshes, this.copies, degraded);
    gl.useProgram(this.program);
    gl.disable(gl.STENCIL_TEST);
    gl.uniformMatrix4fv(this.at('projectionMatrix'), false, camera.projection);
    gl.uniform1i(this.at('toneCurve'), this.toneCurve);
    const drawn = [meshes, diagnosticMeshes, plain, blended, transmissive];
    this.lights.upload(scene, camera.view, drawn);
    this.textures.beginFrame();
    this.pass.beginFrame(camera, gl.getParameter(gl.VIEWPORT) as Int32Array);
    this.geometry.beginFrame();
    this.submission.beginFrame();
    const mirrors = receivers(drawn);
    this.backdropSubmissions = this.copySubmissions = 0;
    gl.uniform1i(this.at('reflectionEnabled'), 0);
    capture(gl, this.reflection, mirrors, this.at('reflectionCapture'), () => {
      this.setOutput(false);
      this.backdropSubmissions +=
        this.submission.submit(meshes, camera, false, true) +
        this.submission.submit(diagnosticMeshes, camera, false, true);
      this.copySubmissions += this.submission.submit(plain, camera, false, true);
    });
    if (transmissive.length) {
      this.backdrop.begin(scene.background);
      this.setOutput(false);
      this.backdropSubmissions +=
        this.submission.submit(meshes, camera, false) +
        this.submission.submit(diagnosticMeshes, camera, false);
      this.copySubmissions += this.submission.submit(plain, camera, false);
      this.backdrop.end();
    }
    this.backdropPasses = (transmissive.length ? 1 : 0) + (mirrors ? 1 : 0);
    gl.uniform1i(this.at('reflectionEnabled'), mirrors ? 1 : 0);
    this.setOutput(srgbDestination);
    const submitted =
      this.submission.submit(meshes, camera, toneMapped) +
      this.submission.submit(diagnosticMeshes, camera, toneMapped);
    this.copySubmissions += this.submission.submit(plain, camera, toneMapped);
    if (transmissive.length) {
      this.backdrop.bind();
      this.pass.forget();
      gl.uniform2f(this.at('backdropOrigin'), this.backdrop.originX, this.backdrop.originY);
      this.copySubmissions += this.submission.submit(transmissive, camera, toneMapped);
    }
    this.copySubmissions += this.submission.submit(blended, camera, toneMapped);
    return submitted;
  }
  dispose() {
    if (!this.display)
      for (const shared of [this.backdrop, this.reflection, this.geometry, this.textures])
        shared.dispose();
    this.lights.dispose();
    this.gl.deleteProgram(this.program);
  }
}
