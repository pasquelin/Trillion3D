import { isClusterDrawMesh, type ClusterDrawMesh } from './clusterBatchMesh.ts';
import { WebglClusterGeometry } from './webglClusterGeometry.ts';
import { WebglClusterTextures } from './webglClusterTextures.ts';
import {
  unsupportedClusterLight,
  WebglClusterLights,
  type WebglClusterScene,
} from './webglClusterLights.ts';
import { WebglClusterState } from './webglClusterState.ts';
import { normalMatrix3 } from '../sdk-core/index.ts';
import { multiplyMatrix4 } from './webglClusterMatrices.ts';
import type { HostDrawCamera } from './cameraWorld.ts';
import { Matrix3UniformCache, setClusterSamplers, setMatrix3 } from './webglClusterUniforms.ts';
import { WebglClusterMaterialUniforms } from './webglClusterMaterialUniforms.ts';
import { createClusterProgram } from './webglClusterProgram.ts';
import { validateClusterMeshes } from './webglClusterValidation.ts';
import { WebglClusterBackdrop } from './webglClusterBackdrop.ts';
import {
  BACKDROP_UNITS,
  bindClusterMaterial,
  type Material,
} from './webglClusterMaterialBinding.ts';
import { refuseCluster } from './webglClusterRefusal.ts';
import { WebglClusterCopyCulling } from './webglClusterCopyCulling.ts';
import type * as THREE from 'three';
import { submitClusterMesh, submitDiagnosticMesh, type MultiDraw } from './webglClusterSubmit.ts';

export class WebglClusterRenderer {
  private gl: WebGL2RenderingContext;
  private program: WebGLProgram;
  private geometry: WebglClusterGeometry;
  private textures: WebglClusterTextures;
  private uniforms = new Map<string, WebGLUniformLocation | null>();
  private normal = new Float32Array(9);
  private modelView = new Float32Array(16);
  private materialMatrices: Matrix3UniformCache;
  private lights: WebglClusterLights;
  private state: WebglClusterState;
  private validatedMaterials = new Map<Material, ClusterDrawMesh['geometry']['attributes']>();
  private materialUniforms: WebglClusterMaterialUniforms;
  private multiDraw: MultiDraw | null;
  private backdrop: WebglClusterBackdrop;
  private culling = new WebglClusterCopyCulling();
  /** Transmissive copies of the frame being drawn that are in view; reused frame to frame. */
  private transmissive: THREE.Mesh[] = [];
  /** Scene copies the last frame submitted: in view and visible. */
  copySubmissions = 0;
  private binding: Parameters<typeof bindClusterMaterial>[0];
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const program = (this.program = createClusterProgram(gl));
    const locations: Record<string, number> = {};
    for (const name of ['position', 'normal', 'tangent', 'uv', 'uv1', 'color'])
      locations[name] = gl.getAttribLocation(program, name);
    this.geometry = new WebglClusterGeometry(gl, locations);
    this.textures = new WebglClusterTextures(gl);
    this.lights = new WebglClusterLights(gl, this.program);
    this.state = new WebglClusterState(gl);
    this.backdrop = new WebglClusterBackdrop(gl, BACKDROP_UNITS);
    this.multiDraw = gl.getExtension('WEBGL_multi_draw') as typeof this.multiDraw;
    this.materialMatrices = new Matrix3UniformCache(gl, (name) => this.at(name));
    this.materialUniforms = new WebglClusterMaterialUniforms(gl, (name) => this.at(name));
    this.binding = {
      uniforms: this.materialUniforms,
      matrices: this.materialMatrices,
      textures: this.textures,
      state: this.state,
    };
    gl.useProgram(program);
    setClusterSamplers(gl, (name) => this.at(name));
  }
  /** Bytes the transmission backdrop holds; zero until a transmissive copy is drawn. */
  get backdropBytes() {
    return this.backdrop.bytes;
  }
  private at(name: string) {
    if (!this.uniforms.has(name))
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }
  private pass(
    mesh: ClusterDrawMesh | THREE.Mesh,
    material: THREE.Material,
    toneMapped: boolean,
    whole: boolean,
    passSide?: number,
    polygonMaterial?: THREE.Material,
  ) {
    if (!material.visible) return 0;
    bindClusterMaterial(this.binding, material as Material, toneMapped, passSide, polygonMaterial);
    if (whole) submitDiagnosticMesh(this.gl, mesh as THREE.Mesh);
    else submitClusterMesh(this.gl, this.multiDraw, mesh as ClusterDrawMesh);
    return 1;
  }
  private mesh(mesh: ClusterDrawMesh | THREE.Mesh, camera: HostDrawCamera, toneMapped: boolean) {
    const gl = this.gl,
      whole = !isClusterDrawMesh(mesh);
    this.geometry.bind(mesh.geometry);
    const model = mesh.matrix.elements;
    multiplyMatrix4(this.modelView, camera.view, model);
    this.state.applyWinding(model);
    gl.uniformMatrix4fv(this.at('modelViewMatrix'), false, this.modelView);
    normalMatrix3(this.normal, this.modelView);
    setMatrix3(gl, this.at('normalMatrix'), this.normal);
    let submitted = 0;
    if (Array.isArray(mesh.material)) {
      const source = (mesh as ClusterDrawMesh)._sideSplitSource!;
      const polygon = (mesh as ClusterDrawMesh)._sideSplitPolygonMaterials;
      submitted += this.pass(mesh, source, toneMapped, whole, 1, polygon?.[0]);
      submitted += this.pass(mesh, source, toneMapped, whole, 0, polygon?.[1]);
    } else submitted = this.pass(mesh, mesh.material, toneMapped, whole);
    return submitted;
  }
  /** Every submission but the transmissive copies, in draw order. */
  private submitOpaque(
    meshes: readonly ClusterDrawMesh[],
    wholeMeshes: readonly THREE.Mesh[],
    camera: HostDrawCamera,
    toneMapped: boolean,
  ) {
    let submitted = 0;
    for (const mesh of meshes) submitted += this.mesh(mesh, camera, toneMapped);
    for (const mesh of wholeMeshes) submitted += this.mesh(mesh, camera, toneMapped);
    return submitted;
  }
  /** The pass's destination; the raster state is re-applied, the backdrop having written masks. */
  private setOutput(srgbDestination: boolean) {
    this.gl.uniform1i(this.at('srgbDestination'), srgbDestination ? 1 : 0);
    this.state.invalidate();
  }
  /** The transmissive copies in view: the host renderer would cull them the same way. */
  private cullCopies(copies: readonly THREE.Mesh[], camera: HostDrawCamera) {
    this.transmissive.length = 0;
    if (!copies.length) return;
    this.culling.begin(camera);
    for (const copy of copies) if (this.culling.visible(copy)) this.transmissive.push(copy);
  }
  /**
   * One frame: the batches, then whole host meshes — diagnostic pages, painted copies — then the
   * transmissive scene copies the owner draws itself. Those read the frozen backdrop, so the
   * frame is first drawn into it, in linear light, before the display pass draws it again.
   */
  draw(
    meshes: readonly ClusterDrawMesh[],
    scene: WebglClusterScene,
    camera: HostDrawCamera,
    toneMapped: boolean,
    srgbDestination: boolean,
    diagnosticMeshes: readonly THREE.Mesh[] = [],
    transmissiveCopies: readonly THREE.Mesh[] = [],
  ) {
    const gl = this.gl;
    const lightReason = unsupportedClusterLight(scene);
    if (lightReason) refuseCluster(lightReason);
    validateClusterMeshes(meshes, diagnosticMeshes, transmissiveCopies, this.validatedMaterials);
    gl.useProgram(this.program);
    gl.disable(gl.STENCIL_TEST);
    gl.uniformMatrix4fv(this.at('projectionMatrix'), false, camera.projection);
    gl.uniform1i(this.at('lightCount'), this.lights.upload(scene, camera.view));
    // The host's texture units are unknown at frame start; the backdrop pass touches only its own.
    this.textures.invalidateBindings();
    this.cullCopies(transmissiveCopies, camera);
    const transmissive = this.transmissive;
    if (transmissive.length) {
      this.backdrop.begin(scene.background);
      this.setOutput(false);
      this.submitOpaque(meshes, diagnosticMeshes, camera, false);
      this.backdrop.end();
    }
    this.setOutput(srgbDestination);
    const submitted = this.submitOpaque(meshes, diagnosticMeshes, camera, toneMapped);
    let copySubmissions = 0;
    if (transmissive.length) {
      this.backdrop.bind();
      gl.uniform2f(this.at('backdropOrigin'), this.backdrop.originX, this.backdrop.originY);
      for (const mesh of transmissive) copySubmissions += this.mesh(mesh, camera, toneMapped);
    }
    this.copySubmissions = copySubmissions;
    return submitted + copySubmissions;
  }
  dispose() {
    this.backdrop.dispose();
    this.geometry.dispose();
    this.textures.dispose();
    this.lights.dispose();
    this.gl.deleteProgram(this.program);
  }
}
