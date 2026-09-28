import { capture, receivers, target } from '../../reflections/captureGl.ts';
import {
  drawPasses,
  isClusterDrawMesh,
  drawTriangles,
  drawWorld,
  type ClusterDrawMesh,
  type HostAttributes,
  type WholeMesh,
} from '../../cluster/batchMesh.ts';
import { isInstancedNode } from '../../host/graph/kinds.ts';
import { WebglClusterGeometry } from './geometry.ts';
import { WebglClusterTextures } from './textures.ts';
import { unsupportedClusterLight, WebglClusterLights, type WebglClusterScene } from './lights.ts';
import { WebglClusterState } from './state.ts';
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/index.ts';
import type { HostDrawCamera } from '../../camera/world.ts';
import { Matrix3UniformCache, ModelUniforms, setClusterSamplers } from './uniforms.ts';
import { WebglClusterMaterialUniforms } from './materialUniforms.ts';
import { createClusterProgram } from './program.ts';
import { validateClusterMeshes, type ReadDegraded } from './validation.ts';
import { WebglClusterBackdrop } from './backdrop.ts';
import { BACKDROP_UNITS, ClusterMaterialPass, type Material } from './materialBinding.ts';
import { refuseCluster } from './refusal.ts';
import { WebglClusterCopies, type SceneCopy } from './copyCulling.ts';
import { submitClusterMesh, submitDiagnosticMesh, type MultiDraw } from './submit.ts';

export class WebglClusterRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private geometry: WebglClusterGeometry;
  readonly textures: WebglClusterTextures;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private model: ModelUniforms;
  private lights: WebglClusterLights;
  private state: WebglClusterState;
  private validatedMaterials = new Map<Material, HostAttributes>();
  private multiDraw: MultiDraw | null;
  private backdrop: WebglClusterBackdrop;
  private reflection: WebglClusterBackdrop;
  private copies = new WebglClusterCopies<SceneCopy>();
  triangles = 0;
  private instanced: boolean | undefined;
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
    this.multiDraw = gl.getExtension('WEBGL_multi_draw') as typeof this.multiDraw;
    this.pass = new ClusterMaterialPass({
      uniforms: new WebglClusterMaterialUniforms(gl, (name) => this.at(name)),
      matrices: new Matrix3UniformCache(gl, (name) => this.at(name)),
      textures: this.textures,
      state: this.state,
      linear: !!display,
    });
    gl.useProgram(program);
    setClusterSamplers(gl, (name) => this.at(name));
    this.model = new ModelUniforms(gl, this.at('modelViewMatrix'), this.at('normalMatrix'));
  }
  get backdropBytes() {
    return this.backdrop.bytes + this.reflection.bytes;
  }
  private at(name: string) {
    if (!this.uniforms.has(name))
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }
  private mesh(mesh: ClusterDrawMesh | WholeMesh, camera: HostDrawCamera, toneMapped: boolean) {
    const gl = this.gl,
      material = mesh.material as Material,
      record = isClusterDrawMesh(mesh) ? mesh : undefined,
      instanced = !record && isInstancedNode(mesh);
    if (!material.visible || (instanced && !mesh.count)) return 0;
    this.geometry.bind(mesh.geometry, instanced ? (mesh as WholeMesh) : undefined);
    this.lights.lists.use(mesh, this.at('lightSpan'));
    if (this.instanced !== instanced) gl.uniform1i(this.at('instanced'), instanced ? 1 : 0);
    this.instanced = instanced;
    const model = drawWorld(mesh);
    if (this.model.set(camera.view, model)) this.state.applyWinding(model);
    const passes = drawPasses(material);
    this.triangles += drawTriangles(mesh) * passes.length;
    for (const side of passes) {
      this.pass.bind(material, toneMapped, side, record?.polygonOffsetUnits);
      if (record) submitClusterMesh(gl, this.multiDraw, record);
      else submitDiagnosticMesh(gl, mesh);
    }
    return passes.length;
  }
  private submit(
    meshes: readonly (ClusterDrawMesh | WholeMesh)[],
    camera: HostDrawCamera,
    toneMapped: boolean,
    opaque = false,
  ) {
    let submitted = 0;
    for (const mesh of meshes)
      if (!opaque || !(mesh.material as Material).transparent)
        submitted += this.mesh(mesh, camera, toneMapped);
    return submitted;
  }
  private setOutput(srgbDestination: boolean) {
    this.gl.uniform1i(this.at('srgbDestination'), srgbDestination ? 1 : 0);
    this.state.invalidate();
    this.pass.forget();
    this.model.forget(); // the winding goes with the raster state
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
    const gl = this.gl;
    const lightReason = unsupportedClusterLight(scene);
    if (lightReason) refuseCluster(lightReason);
    this.copies.cull(copies, camera);
    const { plain, blended, transmissive } = this.copies;
    validateClusterMeshes(meshes, diagnosticMeshes, this.copies, this.validatedMaterials, degraded);
    gl.useProgram(this.program);
    gl.disable(gl.STENCIL_TEST);
    gl.uniformMatrix4fv(this.at('projectionMatrix'), false, camera.projection);
    gl.uniform1i(this.at('toneCurve'), this.toneCurve);
    const drawn = [meshes, diagnosticMeshes, plain, blended, transmissive];
    this.lights.upload(scene, camera.view, drawn);
    this.textures.beginFrame();
    this.instanced = undefined;
    this.model.forget();
    this.pass.beginFrame(camera, gl.getParameter(gl.VIEWPORT) as Int32Array);
    this.geometry.beginFrame();
    this.triangles = 0;
    const mirrors = receivers(drawn);
    let backdropSubmissions = 0,
      copySubmissions = 0;
    gl.uniform1i(this.at('reflectionEnabled'), 0);
    capture(gl, this.reflection, mirrors, this.at('reflectionCapture'), () => {
      this.setOutput(false);
      backdropSubmissions +=
        this.submit(meshes, camera, false, true) +
        this.submit(diagnosticMeshes, camera, false, true);
      copySubmissions += this.submit(plain, camera, false, true);
    });
    if (transmissive.length) {
      this.backdrop.begin(scene.background);
      this.setOutput(false);
      backdropSubmissions +=
        this.submit(meshes, camera, false) + this.submit(diagnosticMeshes, camera, false);
      copySubmissions += this.submit(plain, camera, false);
      this.backdrop.end();
    }
    this.backdropPasses = (transmissive.length ? 1 : 0) + (mirrors ? 1 : 0);
    this.backdropSubmissions = backdropSubmissions;
    gl.uniform1i(this.at('reflectionEnabled'), mirrors ? 1 : 0);
    this.setOutput(srgbDestination);
    const submitted =
      this.submit(meshes, camera, toneMapped) + this.submit(diagnosticMeshes, camera, toneMapped);
    copySubmissions += this.submit(plain, camera, toneMapped);
    if (transmissive.length) {
      this.backdrop.bind();
      this.pass.forget();
      gl.uniform2f(this.at('backdropOrigin'), this.backdrop.originX, this.backdrop.originY);
      copySubmissions += this.submit(transmissive, camera, toneMapped);
    }
    copySubmissions += this.submit(blended, camera, toneMapped);
    this.copySubmissions = copySubmissions;
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
