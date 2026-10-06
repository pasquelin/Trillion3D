import { uniformLocations } from './uniforms.ts'
import {
  SCENE_FOG_FLOATS,
  packFog,
  type SceneFog,
} from '../../../../sdk-core/src/scene/core/fog.ts'

/**
 * THE FOG ON THE WEBGL2 PATH: the scene's fog (`packages/sdk-core/src/scene/core/fog.ts`) packed
 * as the WebGPU contract buffer packs it — colour and mode, then the law — into the program's
 * `fogColor` and `fogLaw` (`../../lighting/fogShader.ts`), the eye's height in the law's last
 * float: the program works in view space, where the eye is the origin.
 */
export class WebglClusterFog {
  private packed = new Float32Array(SCENE_FOG_FLOATS)
  private at: (name: string) => WebGLUniformLocation | null
  private gl: WebGL2RenderingContext
  constructor(gl: WebGL2RenderingContext, program: WebGLProgram) {
    this.gl = gl
    this.at = uniformLocations(gl, program)
  }
  /** Writes `fog`, or none, and the height of the eye `view` (world to view, column-major)
   *  looks from: `−Rᵀ·t`'s y. */
  upload(fog: SceneFog | null | undefined, view: ArrayLike<number>) {
    const packed = packFog(fog ?? undefined, this.packed, 0)
    packed[7] = -(view[4] * view[12] + view[5] * view[13] + view[6] * view[14])
    this.send(this.at)
  }
  /** The fog as last packed, into the program bound now. */
  send(at: (name: string) => WebGLUniformLocation | null) {
    this.gl.uniform4fv(at('fogColor'), this.packed, 0, 4)
    this.gl.uniform4fv(at('fogLaw'), this.packed, 4, 4)
  }
}
