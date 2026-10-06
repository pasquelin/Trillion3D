import { capture, mirrorMeshes, receivers, target } from '../../reflections/captureGl.ts'
import { REFLECTION_RESOLVE_UNITS, reflectionResolveExtent } from '../../reflections/resolveGl.ts'
import type { ClusterDrawMesh, WholeMesh } from '../../cluster/batchMesh.ts'
import { ATTRIBUTES, WebglClusterGeometry } from './geometry.ts'
import { WebglClusterTextures } from './textures.ts'
import { unsupportedClusterLight, WebglClusterLights, type WebglClusterScene } from './lights.ts'
import { WebglClusterState } from './state.ts'
import { TONE_MAPPING_RANK } from '../../../../sdk-core/src/index.ts'
import type { HostDrawCamera } from '../../camera/world.ts'
import { Matrix3UniformCache, setClusterSamplers, uniformLocations } from './uniforms.ts'
import { WebglClusterMaterialUniforms } from './materialUniforms.ts'
import { createClusterProgram } from './program.ts'
import { clusterValidation, type ReadDegraded } from './validation.ts'
import { WebglClusterBackdrop } from './backdrop.ts'
import { BACKDROP_UNITS, ClusterMaterialPass } from './materialBinding.ts'
import { refuseCluster } from './refusal.ts'
import { WebglClusterCopies, type SceneCopy } from './copyCulling.ts'
import { WebglClusterSubmission } from './submission.ts'
import type { FramePass } from '../core/frameTimer.ts'
import { WebglClusterDeformation, type DeformationSource } from './deformation.ts'
import { cardPassOf, type CardSwitches, type WebglCards } from '../impostor/pass.ts'

export class WebglClusterRenderer {
  private gl: WebGL2RenderingContext
  private program: WebGLProgram
  private geometry: WebglClusterGeometry
  readonly textures: WebglClusterTextures
  private at: (name: string) => WebGLUniformLocation | null
  private lights: WebglClusterLights
  private state: WebglClusterState
  /** Reads each frame's surfaces; hears, by name and required, a lost feature or a left-out one. */
  private readonly validation: ReturnType<typeof clusterValidation>
  private submission: WebglClusterSubmission
  private backdrop: WebglClusterBackdrop
  private reflection: WebglClusterBackdrop
  /** Reduced-resolution mirror trace: the receiver-only image the main pass samples. */
  private resolve: WebglClusterBackdrop
  private copies = new WebglClusterCopies<SceneCopy>()
  copySubmissions = 0
  backdropSubmissions = 0
  backdropPasses = 0
  resolvePasses = 0
  toneCurve: number = TONE_MAPPING_RANK.aces
  readonly pass: ClusterMaterialPass
  /** The session's deformation records, sent at each frame; shared with the display's. */
  readonly deformation: WebglClusterDeformation
  deformationSource: DeformationSource | undefined
  cards: WebglCards | undefined
  private readonly display: WebglClusterRenderer | undefined
  private readonly locations: Record<string, number>
  constructor(gl: WebGL2RenderingContext, degraded: ReadDegraded, display?: WebglClusterRenderer) {
    this.gl = gl
    this.validation = clusterValidation(degraded)
    this.display = display
    const program = (this.program = createClusterProgram(gl, display?.locations))
    this.at = uniformLocations(gl, program)
    this.locations = display?.locations ?? {}
    if (!display)
      for (const name of [...ATTRIBUTES, 'instanceMatrix'])
        this.locations[name] = gl.getAttribLocation(program, name)
    this.geometry = display?.geometry ?? new WebglClusterGeometry(gl, this.locations)
    this.textures = display?.textures ?? new WebglClusterTextures(gl)
    this.deformation = display?.deformation ?? new WebglClusterDeformation(gl)
    this.lights = new WebglClusterLights(gl, this.program)
    this.state = display?.state ?? new WebglClusterState(gl)
    this.backdrop = display?.backdrop ?? new WebglClusterBackdrop(gl, BACKDROP_UNITS)
    this.reflection = display?.reflection ?? target(gl)
    this.resolve =
      display?.resolve ?? new WebglClusterBackdrop(gl, REFLECTION_RESOLVE_UNITS, undefined, true)
    const { textures, state, geometry, deformation } = this
    this.pass = new ClusterMaterialPass({
      uniforms: new WebglClusterMaterialUniforms(gl, (name) => this.at(name)),
      matrices: new Matrix3UniformCache(gl, (name) => this.at(name)),
      textures,
      state,
      linear: !!display,
    })
    gl.useProgram(program)
    setClusterSamplers(gl, (name) => this.at(name))
    const parts = { geometry, state, pass: this.pass, deformation, leaves: this.validation.leaves }
    this.submission = new WebglClusterSubmission(gl, parts, (name) => this.at(name))
  }
  /** Triangles the frame submitted, every pass included. */
  get triangles() {
    return this.submission.triangles
  }
  get backdropBytes() {
    return this.backdrop.bytes + this.reflection.bytes + this.resolve.bytes
  }
  private setOutput(srgbDestination: boolean) {
    this.gl.useProgram(this.program)
    this.gl.uniform1i(this.at('srgbDestination'), srgbDestination ? 1 : 0)
    this.state.invalidate()
    this.pass.forget()
    this.submission.forget()
  }
  /** The cards in a pass, with its switches and lights; this program is bound again after. */
  private drawCards(camera: HostDrawCamera, on: CardSwitches) {
    const p = cardPassOf(this.toneCurve, this.resolvePasses > 0, on)
    if (this.cards?.(camera, this.lights, p, !!this.display)) this.setOutput(p.srgbDestination)
  }
  draw(
    meshes: readonly ClusterDrawMesh[],
    scene: WebglClusterScene,
    camera: HostDrawCamera,
    toneMapped: boolean,
    srgbDestination: boolean,
    diagnosticMeshes: readonly WholeMesh[] = [],
    copies: readonly SceneCopy[] = [],
    pass?: FramePass,
  ) {
    const gl = this.gl,
      lightReason = unsupportedClusterLight(scene.lights)
    if (lightReason) refuseCluster(lightReason)
    this.copies.cull(copies, camera)
    const { plain, blended, transmissive } = this.copies
    this.validation.validate(meshes, diagnosticMeshes, this.copies)
    gl.useProgram(this.program)
    gl.disable(gl.STENCIL_TEST)
    gl.uniformMatrix4fv(this.at('projectionMatrix'), false, camera.projection)
    gl.uniform1i(this.at('toneCurve'), this.toneCurve)
    const drawn = [meshes, diagnosticMeshes, plain, blended, transmissive]
    this.lights.upload(scene, camera.view)
    this.textures.beginFrame()
    this.deformation.beginFrame(this.deformationSource)
    this.pass.beginFrame(camera, gl.getParameter(gl.VIEWPORT) as Int32Array)
    this.geometry.beginFrame()
    this.submission.beginFrame()
    const mirrors = receivers(drawn),
      mirroring = mirrors ? mirrorMeshes(drawn) : []
    this.backdropSubmissions = this.copySubmissions = this.resolvePasses = 0
    for (const name of ['reflectionEnabled', 'reflectionResolve', 'reflectionOutput'])
      gl.uniform1i(this.at(name), 0)
    if (mirrors) pass?.('Trillion3D WebGL2 reflection capture')
    capture(gl, this.reflection, mirrors, this.at('reflectionCapture'), () => {
      this.setOutput(false)
      this.backdropSubmissions +=
        this.submission.submit(meshes, camera, false, true) +
        this.submission.submit(diagnosticMeshes, camera, false, true)
      this.copySubmissions += this.submission.submit(plain, camera, false, true)
      this.drawCards(camera, { capture: true })
    })
    // The receivers alone, traced once into the reduced image. `begin` releases the resolve's
    // units; the frozen source is bound again for the trace they aliased before it.
    if (mirroring.length) {
      pass?.('Trillion3D WebGL2 reflection resolve')
      const viewport = gl.getParameter(gl.VIEWPORT) as Int32Array
      this.resolve.begin(null, reflectionResolveExtent(viewport[2], viewport[3]))
      this.reflection.bind()
      gl.uniform1i(this.at('reflectionEnabled'), 1)
      gl.uniform1i(this.at('reflectionOutput'), 1)
      this.setOutput(false)
      this.submission.submit(mirroring, camera, false)
      this.resolve.end()
      this.resolve.bind()
      gl.uniform1i(this.at('reflectionOutput'), 0)
      gl.uniform1i(this.at('reflectionEnabled'), 0)
      gl.uniform1i(this.at('reflectionResolve'), 1)
      this.resolvePasses = 1
    } else this.resolve.dispose()
    if (transmissive.length) {
      pass?.('Trillion3D WebGL2 transmission backdrop')
      this.backdrop.begin(scene.background)
      this.setOutput(false)
      this.backdropSubmissions +=
        this.submission.submit(meshes, camera, false) +
        this.submission.submit(diagnosticMeshes, camera, false)
      this.copySubmissions += this.submission.submit(plain, camera, false)
      this.drawCards(camera, {})
      this.backdrop.end()
    }
    this.backdropPasses = (transmissive.length ? 1 : 0) + (mirrors ? 1 : 0)
    gl.uniform1i(this.at('reflectionEnabled'), mirrors ? 1 : 0)
    this.setOutput(srgbDestination)
    pass?.('Trillion3D WebGL2 opaque')
    const submitted =
      this.submission.submit(meshes, camera, toneMapped) +
      this.submission.submit(diagnosticMeshes, camera, toneMapped)
    this.copySubmissions += this.submission.submit(plain, camera, toneMapped)
    this.drawCards(camera, { toneMapped, srgbDestination, reflections: mirrors })
    if (transmissive.length) {
      pass?.('Trillion3D WebGL2 transmission')
      this.backdrop.bind()
      this.pass.forget()
      gl.uniform2f(this.at('backdropOrigin'), this.backdrop.originX, this.backdrop.originY)
      this.copySubmissions += this.submission.submit(transmissive, camera, toneMapped)
    }
    pass?.('Trillion3D WebGL2 transparents')
    this.copySubmissions += this.submission.submit(blended, camera, toneMapped)
    return submitted
  }
  dispose() {
    const { backdrop, reflection, resolve, geometry, textures, deformation } = this
    if (!this.display)
      for (const shared of [backdrop, reflection, resolve, geometry, textures, deformation])
        shared.dispose()
    this.lights.dispose()
    this.gl.deleteProgram(this.program)
  }
}
