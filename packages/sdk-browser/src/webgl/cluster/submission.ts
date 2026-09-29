import {
  drawPasses,
  drawTriangles,
  drawWorld,
  isClusterDrawMesh,
  type ClusterDraw,
  type WholeMesh,
} from '../../cluster/batchMesh.ts';
import { isInstancedNode } from '../../host/graph/kinds.ts';
import type { HostDrawCamera } from '../../camera/world.ts';
import type { WebglClusterGeometry } from './geometry.ts';
import type { WebglClusterLightLists } from './lightLists.ts';
import type { WebglClusterState } from './state.ts';
import type { ClusterMaterialPass, Material } from './materialBinding.ts';
import { ModelUniforms } from './uniforms.ts';
import { WebglClusterPlans } from './runs.ts';
import { submitClusterMesh, submitDiagnosticMesh, type MultiDraw } from './submit.ts';

type Uniform = (name: string) => WebGLUniformLocation | null;

/**
 * THE SUBMISSIONS OF A RENDERER'S PASSES: each drawn list replayed by the runs the frame read it
 * into (`runs.ts`) — a run of pages in one command, any other mesh on its own buffers as it always
 * was —, each with its light list, placements, matrix and surface. It counts the triangles the
 * frame submits, every pass included.
 */
export class WebglClusterSubmission {
  triangles = 0;
  private instanced: boolean | undefined;
  private model: ModelUniforms;
  private plans: WebglClusterPlans;
  private multiDraw: MultiDraw | null;
  private gl: WebGL2RenderingContext;
  private geometry: WebglClusterGeometry;
  private lists: WebglClusterLightLists;
  private state: WebglClusterState;
  private pass: ClusterMaterialPass;
  private lightSpan: WebGLUniformLocation | null;
  private instancedAt: WebGLUniformLocation | null;
  constructor(
    gl: WebGL2RenderingContext,
    parts: {
      geometry: WebglClusterGeometry;
      lists: WebglClusterLightLists;
      state: WebglClusterState;
      pass: ClusterMaterialPass;
    },
    at: Uniform,
  ) {
    this.gl = gl;
    ({ geometry: this.geometry, lists: this.lists, state: this.state, pass: this.pass } = parts);
    this.model = new ModelUniforms(gl, at('modelViewMatrix'), at('normalMatrix'));
    this.plans = new WebglClusterPlans(this.geometry.arenas, this.lists);
    this.multiDraw = gl.getExtension('WEBGL_multi_draw') as MultiDraw | null;
    this.lightSpan = at('lightSpan');
    this.instancedAt = at('instanced');
  }
  /** A new frame: nothing counted, every list read again at its first pass. */
  beginFrame() {
    this.triangles = 0;
    this.plans.beginFrame();
  }
  /** A new destination: the matrix and placements are sent again, the winding with them. */
  forget() {
    this.model.forget();
    this.instanced = undefined;
  }
  /** Draws `meshes`; `opaque` skips the transparent ones. Returns the submissions. */
  submit(
    meshes: readonly ClusterDraw[],
    camera: HostDrawCamera,
    toneMapped: boolean,
    opaque = false,
  ) {
    const runs = this.plans.of(meshes);
    let submitted = 0;
    for (let k = 0; k < runs.count; k++) {
      const head = runs.heads[k],
        material = head.material as Material,
        arena = runs.arenas[k];
      if (opaque && material.transparent) continue;
      if (!arena) {
        submitted += this.mesh(head, camera, toneMapped);
        continue;
      }
      this.place(head, runs.lists[k], false, camera.view);
      this.pass.bind(material, toneMapped);
      this.geometry.bindArena(arena.vao);
      runs.submit(this.gl, this.multiDraw, k);
      this.triangles += runs.triangles[k];
      submitted++;
    }
    return submitted;
  }
  /** The state of one draw of `mesh`: its light list `list`, its placements and its matrix. */
  private place(mesh: ClusterDraw, list: number, instanced: boolean, view: ArrayLike<number>) {
    this.lists.use(list, this.lightSpan);
    if (this.instanced !== instanced) this.gl.uniform1i(this.instancedAt, instanced ? 1 : 0);
    this.instanced = instanced;
    const model = drawWorld(mesh);
    if (this.model.set(view, model)) this.state.applyWinding(model);
  }
  /** A mesh on its own buffers: once, or once per side of a two-sided transparent surface. */
  private mesh(mesh: ClusterDraw, camera: HostDrawCamera, toneMapped: boolean) {
    const gl = this.gl,
      material = mesh.material as Material,
      record = isClusterDrawMesh(mesh) ? mesh : undefined,
      instanced = !record && isInstancedNode(mesh);
    if (instanced && !mesh.count) return 0;
    this.geometry.bind(mesh.geometry, instanced ? (mesh as WholeMesh) : undefined);
    this.place(mesh, this.lists.listOf(mesh), instanced, camera.view);
    const passes = drawPasses(material);
    this.triangles += drawTriangles(mesh) * passes.length;
    for (const side of passes) {
      this.pass.bind(material, toneMapped, side, record?.polygonOffsetUnits);
      if (record) submitClusterMesh(gl, this.multiDraw, record);
      else submitDiagnosticMesh(gl, mesh);
    }
    return passes.length;
  }
}
