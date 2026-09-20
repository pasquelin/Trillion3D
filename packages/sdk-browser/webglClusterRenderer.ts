import { visMaterial } from './visibilityMaterial.ts';
import type { ClusterDrawMesh } from './clusterBatchMesh.ts';
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
import type * as THREE from 'three';
import { submitClusterMesh, submitDiagnosticMesh, type MultiDraw } from './webglClusterSubmit.ts';
type Material = Exclude<ClusterDrawMesh['material'], unknown[]>;
const IDENTITY_MATRIX3 = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]);
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
  private validatedMaterials = new Map<
    Exclude<ClusterDrawMesh['material'], unknown[]>,
    ClusterDrawMesh['geometry']['attributes']
  >();
  private materialUniforms: WebglClusterMaterialUniforms;
  private multiDraw: MultiDraw | null;
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
    this.multiDraw = gl.getExtension('WEBGL_multi_draw') as typeof this.multiDraw;
    this.materialMatrices = new Matrix3UniformCache(gl, (name) => this.at(name));
    this.materialUniforms = new WebglClusterMaterialUniforms(gl, (name) => this.at(name));
    gl.useProgram(program);
    setClusterSamplers(gl, (name) => this.at(name));
  }
  private at(name: string) {
    if (!this.uniforms.has(name))
      this.uniforms.set(name, this.gl.getUniformLocation(this.program, name));
    return this.uniforms.get(name)!;
  }
  private material(material: Material, toneMapped: boolean, passSide?: number) {
    const source = material as { opacity: number },
      mat = visMaterial(material);
    const basic = material as import('three').MeshBasicMaterial,
      aoMap = mat.aoMap ?? (!mat.lit ? (basic.aoMap ?? undefined) : undefined),
      aoIntensity = mat.aoMap ? mat.aoIntensity : (basic.aoMapIntensity ?? 1);
    this.materialUniforms.f4(
      0,
      'baseFactor',
      mat.baseColor[0],
      mat.baseColor[1],
      mat.baseColor[2],
      material.transparent ? source.opacity : 1,
    );
    this.materialUniforms.f1(4, 'metalFactor', mat.metalness);
    this.materialUniforms.f1(5, 'roughFactor', mat.roughness);
    this.materialUniforms.f1(6, 'alphaCutoff', mat.alphaTest);
    this.materialUniforms.f2(7, 'normalScale', mat.normalScale, mat.normalScaleY);
    this.materialUniforms.f1(9, 'aoStrength', aoIntensity);
    this.materialUniforms.f3(10, 'emissiveFactor', mat.emissive);
    this.materialUniforms.i1(13, 'lit', mat.lit ? 1 : 0);
    this.materialUniforms.i1(14, 'hasNormalMap', mat.normalMap ? 1 : 0);
    this.materialUniforms.i1(15, 'hasVertexColor', material.vertexColors ? 1 : 0);
    this.materialUniforms.i1(16, 'toneMapped', toneMapped && material.toneMapped ? 1 : 0);
    const maps = [
      'map',
      'roughnessMap',
      'metalnessMap',
      'normalMap',
      'aoMap',
      'emissiveMap',
    ] as const;
    const sharedMetalRough =
      !!mat.roughnessMap &&
      mat.roughnessMap === mat.metalnessMap &&
      mat.roughnessMap.channel === mat.metalnessMap.channel;
    let mapMask = 0;
    for (let unit = 0; unit < maps.length; unit++) {
      const texture = maps[unit] === 'aoMap' ? aoMap : mat[maps[unit]];
      if (texture) mapMask |= 1 << unit;
      this.textures.bind(
        unit,
        sharedMetalRough && unit === 2 ? undefined : texture,
        texture?.colorSpace === 'srgb',
        unit === 3 ? [128, 128, 255, 255] : undefined,
      );
      if (!texture || (sharedMetalRough && unit === 2)) continue;
      if (texture?.matrixAutoUpdate) texture.updateMatrix();
      this.materialMatrices.set(
        ['baseUv', 'roughUv', 'metalUv', 'normalUv', 'aoUv', 'emissiveUv'][unit],
        texture?.matrix.elements ?? IDENTITY_MATRIX3,
      );
    }
    this.materialUniforms.i1(23, 'mapMask', mapMask);
    this.materialUniforms.i1(24, 'sharedMetalRough', sharedMetalRough ? 1 : 0);
    this.materialUniforms.i4(
      17,
      'mapChannels',
      mat.map?.channel ?? 0,
      mat.roughnessMap?.channel ?? 0,
      mat.metalnessMap?.channel ?? 0,
      mat.normalMap?.channel ?? 0,
    );
    this.materialUniforms.i2(
      21,
      'extraChannels',
      aoMap?.channel ?? 0,
      mat.emissiveMap?.channel ?? 0,
    );
    this.state.apply(
      material,
      passSide === undefined ? mat.doubleSided : false,
      passSide === undefined ? mat.backSide : passSide === 1,
    );
  }
  private pass(
    mesh: ClusterDrawMesh | THREE.Mesh,
    material: THREE.Material,
    toneMapped: boolean,
    diagnostic: boolean,
    passSide?: number,
  ) {
    if (!material.visible) return 0;
    this.material(material, toneMapped, passSide);
    if (diagnostic) submitDiagnosticMesh(this.gl, mesh);
    else submitClusterMesh(this.gl, this.multiDraw, mesh as ClusterDrawMesh);
    return 1;
  }
  private mesh(
    mesh: ClusterDrawMesh | THREE.Mesh,
    camera: HostDrawCamera,
    toneMapped: boolean,
    diagnostic: boolean,
  ) {
    const gl = this.gl;
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
      submitted += this.pass(mesh, source, toneMapped, diagnostic, 1);
      submitted += this.pass(mesh, source, toneMapped, diagnostic, 0);
    } else submitted = this.pass(mesh, mesh.material, toneMapped, diagnostic);
    return submitted;
  }
  draw(
    meshes: readonly ClusterDrawMesh[],
    scene: WebglClusterScene,
    camera: HostDrawCamera,
    toneMapped: boolean,
    srgbDestination: boolean,
    diagnosticMeshes: readonly THREE.Mesh[] = [],
  ) {
    const gl = this.gl;
    const lightReason = unsupportedClusterLight(scene);
    if (lightReason) throw new Error(`Unsupported autonomous cluster light: ${lightReason}`);
    validateClusterMeshes(meshes, diagnosticMeshes, this.validatedMaterials);
    this.state.invalidate();
    gl.useProgram(this.program);
    gl.disable(gl.STENCIL_TEST);
    gl.uniformMatrix4fv(this.at('projectionMatrix'), false, camera.projection);
    gl.uniform1i(this.at('srgbDestination'), srgbDestination ? 1 : 0);
    gl.uniform1i(this.at('lightCount'), this.lights.upload(scene, camera.view));
    this.textures.invalidateBindings();
    let submitted = 0;
    for (const mesh of meshes) submitted += this.mesh(mesh, camera, toneMapped, false);
    for (const mesh of diagnosticMeshes) submitted += this.mesh(mesh, camera, toneMapped, true);
    return submitted;
  }
  dispose() {
    this.geometry.dispose();
    this.textures.dispose();
    this.lights.dispose();
    this.gl.deleteProgram(this.program);
  }
}
