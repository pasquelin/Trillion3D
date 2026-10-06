import {
  drawPasses,
  drawTriangles,
  drawWorld,
  isClusterDrawMesh,
  type ClusterDraw,
  type WholeMesh,
} from '../../cluster/batchMesh.ts'
import { isInstancedNode } from '../../host/graph/kinds.ts'
import type { HostDrawCamera } from '../../camera/world.ts'
import type { WebglClusterGeometry } from './geometry.ts'
import type { WebglClusterState } from './state.ts'
import type { ClusterMaterialPass, Material } from './materialBinding.ts'
import { setMatrix3 } from './uniforms.ts'
import { normalMatrix3 } from '../../../../sdk-core/src/index.ts'
import { multiplyMatrix4Typed } from '../../../../sdk-core/src/math/matrix/matrix4Typed.ts'
import { WebglClusterPlans } from './runs.ts'
import { submitClusterMesh, submitDiagnosticMesh, type MultiDraw } from './submit.ts'
import type { WebglClusterDeformation } from './deformation.ts'

type Uniform = (name: string) => WebGLUniformLocation | null

/**
 * THE SUBMISSIONS OF A RENDERER'S PASSES: each drawn list replayed by the runs the frame read it
 * into (`runs.ts`) — a run of pages in one command, any other mesh on its own buffers as it always
 * was —, each with its placements, matrix and surface; a mesh the frame's validation leaves out
 * (`leaves`, `validation.ts`) is drawn by none. It counts the triangles the frame submits, every
 * pass included.
 */
export class WebglClusterSubmission {
  triangles = 0
  private instanced: boolean | undefined
  private modelView = new Float64Array(16)
  private upload = new Float32Array(16)
  private normal = new Float32Array(9)
  private at: Uniform
  private plans: WebglClusterPlans
  private multiDraw: MultiDraw | null
  private gl: WebGL2RenderingContext
  private geometry: WebglClusterGeometry
  private state: WebglClusterState
  private pass: ClusterMaterialPass
  private deformation: WebglClusterDeformation
  /** The draw's `deformDraw` and the one last sent (`deformation.ts`). */
  private deform = new Int32Array(3)
  private deformSent = new Int32Array([-1, -1, -1])
  constructor(
    gl: WebGL2RenderingContext,
    parts: {
      geometry: WebglClusterGeometry
      state: WebglClusterState
      pass: ClusterMaterialPass
      deformation: WebglClusterDeformation
      leaves: (mesh: ClusterDraw) => boolean
    },
    at: Uniform,
  ) {
    this.gl = gl
    ;({ geometry: this.geometry, state: this.state, pass: this.pass } = parts)
    this.deformation = parts.deformation
    this.at = at
    this.plans = new WebglClusterPlans(this.geometry.arenas, parts.leaves)
    this.multiDraw = gl.getExtension('WEBGL_multi_draw') as MultiDraw | null
  }
  /** A new frame: nothing counted, every list read again at its first pass. */
  beginFrame() {
    this.triangles = 0
    this.plans.beginFrame()
  }
  /** A new destination: the placements are sent again. */
  forget() {
    this.instanced = undefined
    this.deformSent.fill(-1)
  }
  /** Draws `meshes`; `opaque` skips the transparent ones. Returns the submissions. */
  submit(
    meshes: readonly ClusterDraw[],
    camera: HostDrawCamera,
    toneMapped: boolean,
    opaque = false,
  ) {
    const runs = this.plans.of(meshes)
    let submitted = 0
    for (let k = 0; k < runs.count; k++) {
      const head = runs.heads[k],
        material = head.material as Material,
        arena = runs.arenas[k]
      if (opaque && material.transparent) continue
      if (!arena) {
        submitted += this.mesh(head, camera, toneMapped)
        continue
      }
      this.place(head, false, camera.view)
      this.pass.bind(material, toneMapped)
      this.geometry.bindArena(arena.vao)
      runs.submit(this.gl, this.multiDraw, k)
      this.triangles += runs.triangles[k]
      submitted++
    }
    return submitted
  }
  /** The state of one draw of `mesh`: its placements, its matrix and its deformation. */
  private place(mesh: ClusterDraw, instanced: boolean, view: ArrayLike<number>) {
    if (this.instanced !== instanced) this.gl.uniform1i(this.at('instanced'), instanced ? 1 : 0)
    this.instanced = instanced
    const model = drawWorld(mesh)
    multiplyMatrix4Typed(this.modelView, view, model)
    this.state.applyWinding(model)
    this.upload.set(this.modelView)
    this.gl.uniformMatrix4fv(this.at('modelViewMatrix'), false, this.upload)
    normalMatrix3(this.normal, this.modelView)
    setMatrix3(this.gl, this.at('normalMatrix'), this.normal)
    const deform = this.deform,
      sent = this.deformSent
    this.deformation.of(mesh, mesh.geometry, deform)
    if (deform[0] === sent[0] && deform[1] === sent[1] && deform[2] === sent[2]) return
    sent.set(deform)
    this.gl.uniform3iv(this.at('deformDraw'), deform)
  }
  /** A mesh on its own buffers: once, or once per side of a two-sided transparent surface. */
  private mesh(mesh: ClusterDraw, camera: HostDrawCamera, toneMapped: boolean) {
    const gl = this.gl,
      material = mesh.material as Material,
      record = isClusterDrawMesh(mesh) ? mesh : undefined,
      instanced = !record && isInstancedNode(mesh)
    if (instanced && !mesh.count) return 0
    this.geometry.bind(mesh.geometry, instanced ? (mesh as WholeMesh) : undefined)
    this.place(mesh, instanced, camera.view)
    const passes = drawPasses(material)
    this.triangles += drawTriangles(mesh) * passes.length
    for (const side of passes) {
      this.pass.bind(material, toneMapped, side, record?.polygonOffsetUnits)
      if (record) submitClusterMesh(gl, this.multiDraw, record)
      else submitDiagnosticMesh(gl, mesh)
    }
    return passes.length
  }
}
