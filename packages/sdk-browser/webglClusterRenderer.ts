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
import { WebglClusterCopies } from './webglClusterCopyCulling.ts';
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
  private copies = new WebglClusterCopies<THREE.Mesh>();
  /** Submissions of the scene copies in view, over both passes of the last frame. */
  copySubmissions = 0;
  /** Cluster submissions of the last frame's backdrop pass; zero without a transmissive copy. */
  backdropSubmissions = 0;
  /** Whether the last frame drew the backdrop pass: its submissions are the display pass's again. */
  backdropPasses = 0;
  private binding: Parameters<typeof bindClusterMaterial>[0];
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    const program = (this.program = createClusterProgram(gl));
    const locations: Record<string, number> = {};
    for (const name of ['position', 'normal', 'uv', 'uv1', 'color'])
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
    const material = mesh.material;
    if (Array.isArray(material)) {
      const source = (mesh as ClusterDrawMesh)._sideSplitSource!;
      const polygon = (mesh as ClusterDrawMesh)._sideSplitPolygonMaterials;
      submitted += this.pass(mesh, source, toneMapped, whole, 1, polygon?.[0]);
      submitted += this.pass(mesh, source, toneMapped, whole, 0, polygon?.[1]);
    } else if (material.transparent && material.side === 2 && !material.forceSinglePass) {
      // A two-sided transparent whole mesh draws back faces then front faces, as the batches do.
      submitted += this.pass(mesh, material, toneMapped, whole, 1);
      submitted += this.pass(mesh, material, toneMapped, whole, 0);
    } else submitted = this.pass(mesh, material, toneMapped, whole);
    return submitted;
  }
  /** The paged clusters and the whole page meshes, in draw order; the copies come after. */
  private submitClusters(
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
  private submitPlainCopies(camera: HostDrawCamera, toneMapped: boolean) {
    let submitted = 0;
    for (const mesh of this.copies.plain) submitted += this.mesh(mesh, camera, toneMapped);
    return submitted;
  }
  /** The pass's destination; the raster state is re-applied, the backdrop having written masks. */
  private setOutput(srgbDestination: boolean) {
    this.gl.uniform1i(this.at('srgbDestination'), srgbDestination ? 1 : 0);
    this.state.invalidate();
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
    copies: readonly THREE.Mesh[] = [],
  ) {
    const gl = this.gl;
    const lightReason = unsupportedClusterLight(scene);
    if (lightReason) refuseCluster(lightReason);
    this.copies.cull(copies, camera);
    const { plain, transmissive } = this.copies;
    validateClusterMeshes(meshes, diagnosticMeshes, plain, transmissive, this.validatedMaterials);
    gl.useProgram(this.program);
    gl.disable(gl.STENCIL_TEST);
    gl.uniformMatrix4fv(this.at('projectionMatrix'), false, camera.projection);
    gl.uniform1i(this.at('lightCount'), this.lights.upload(scene, camera.view));
    // The host's texture units are unknown at frame start; the backdrop pass touches only its own.
    this.textures.invalidateBindings();
    let backdropSubmissions = 0,
      copySubmissions = 0;
    if (transmissive.length) {
      this.backdrop.begin(scene.background);
      this.setOutput(false);
      backdropSubmissions = this.submitClusters(meshes, diagnosticMeshes, camera, false);
      copySubmissions = this.submitPlainCopies(camera, false);
      this.backdrop.end();
    }
    this.backdropPasses = transmissive.length ? 1 : 0;
    this.backdropSubmissions = backdropSubmissions;
    this.setOutput(srgbDestination);
    const submitted = this.submitClusters(meshes, diagnosticMeshes, camera, toneMapped);
    copySubmissions += this.submitPlainCopies(camera, toneMapped);
    if (transmissive.length) {
      this.backdrop.bind();
      gl.uniform2f(this.at('backdropOrigin'), this.backdrop.originX, this.backdrop.originY);
      for (const mesh of transmissive) copySubmissions += this.mesh(mesh, camera, toneMapped);
    }
    this.copySubmissions = copySubmissions;
    return submitted;
  }
  dispose() {
    this.backdrop.dispose();
    this.geometry.dispose();
    this.textures.dispose();
    this.lights.dispose();
    this.gl.deleteProgram(this.program);
  }
}
