import type { ClusterDrawMesh } from '../../cluster/batchMesh.ts';
import { BLEND_EQUATIONS, blendingOf, drawnBlending } from '../../scene/materialBlending.ts';
import { isTransmissive } from '../../visibility/shader/material.ts';

type Material = Exclude<ClusterDrawMesh['material'], unknown[]>;

/** The WebGL2 enum of each blend factor and operation `BLEND_EQUATIONS` writes. */
const glBlendEnums = (gl: WebGL2RenderingContext): Record<string, number> => ({
  zero: gl.ZERO,
  one: gl.ONE,
  src: gl.SRC_COLOR,
  'one-minus-src': gl.ONE_MINUS_SRC_COLOR,
  'src-alpha': gl.SRC_ALPHA,
  'one-minus-src-alpha': gl.ONE_MINUS_SRC_ALPHA,
  add: gl.FUNC_ADD,
});

/** The equation of a transparent surface's mode, or `undefined` when it replaces the target: the
 *  mode every path draws, refused by the one refusal the gate shares (`drawnBlending`). */
const equationOf = (material: Material) =>
  BLEND_EQUATIONS[
    drawnBlending(blendingOf(material.blending as number | undefined), isTransmissive(material))
  ];

const depthFunction = (gl: WebGL2RenderingContext, value: number) => {
  switch (value) {
    case 0:
      return gl.NEVER;
    case 1:
      return gl.ALWAYS;
    case 2:
      return gl.LESS;
    case 4:
      return gl.EQUAL;
    case 5:
      return gl.GEQUAL;
    case 6:
      return gl.GREATER;
    case 7:
      return gl.NOTEQUAL;
    default:
      return gl.LEQUAL;
  }
};

export class WebglClusterState {
  private cull = -1;
  private face = -1;
  private depth = -1;
  private depthFunction = -1;
  private depthWrite = -1;
  private colorWrite = -1;
  private polygon = -1;
  private polygonFactor = Number.NaN;
  private polygonUnits = Number.NaN;
  private winding = -1;
  private blend = -1;
  private gl: WebGL2RenderingContext;
  /** The context's blend enums, by the names `BLEND_EQUATIONS` writes: built once. */
  private blendEnums: Record<string, number>;
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
    this.blendEnums = glBlendEnums(gl);
  }
  invalidate() {
    this.cull = this.face = this.depth = this.depthFunction = -1;
    this.depthWrite = this.colorWrite = this.polygon = -1;
    this.winding = -1;
    this.blend = -1;
    this.polygonFactor = this.polygonUnits = Number.NaN;
  }
  applyWinding(matrix: ArrayLike<number>) {
    const determinant =
      matrix[0] * (matrix[5] * matrix[10] - matrix[6] * matrix[9]) -
      matrix[4] * (matrix[1] * matrix[10] - matrix[2] * matrix[9]) +
      matrix[8] * (matrix[1] * matrix[6] - matrix[2] * matrix[5]);
    const winding = determinant < 0 ? this.gl.CW : this.gl.CCW;
    if (winding !== this.winding) this.gl.frontFace(winding);
    this.winding = winding;
  }
  private capability(enabled: boolean, previous: number, capability: number) {
    const next = enabled ? 1 : 0;
    if (previous !== next) {
      if (enabled) this.gl.enable(capability);
      else this.gl.disable(capability);
    }
    return next;
  }
  /** `polygonOffsetUnits` is the depth offset of a coplanar layer, which replaces the
   *  material's own offset; undefined, the material's applies. */
  apply(material: Material, doubleSided: boolean, backSide: boolean, polygonOffsetUnits?: number) {
    const gl = this.gl;
    const equation = material.transparent ? equationOf(material) : undefined;
    this.blend = this.capability(!!equation, this.blend, gl.BLEND);
    if (equation) {
      const { color, alpha } = equation,
        e = (name: string | undefined) => this.blendEnums[name!];
      gl.blendEquationSeparate(e(color.operation), e(alpha.operation));
      gl.blendFuncSeparate(
        e(color.srcFactor),
        e(color.dstFactor),
        e(alpha.srcFactor),
        e(alpha.dstFactor),
      );
    }
    this.cull = this.capability(!doubleSided, this.cull, gl.CULL_FACE);
    const face = backSide ? gl.FRONT : gl.BACK;
    if (!doubleSided && this.face !== face) gl.cullFace(face);
    this.face = face;
    this.depth = this.capability(material.depthTest, this.depth, gl.DEPTH_TEST);
    const depth = depthFunction(gl, material.depthFunc);
    if (this.depthFunction !== depth) gl.depthFunc(depth);
    this.depthFunction = depth;
    const depthWrite = material.depthWrite ? 1 : 0;
    if (this.depthWrite !== depthWrite) gl.depthMask(material.depthWrite);
    this.depthWrite = depthWrite;
    const colorWrite = material.colorWrite ? 1 : 0;
    if (this.colorWrite !== colorWrite)
      gl.colorMask(
        material.colorWrite,
        material.colorWrite,
        material.colorWrite,
        material.colorWrite,
      );
    this.colorWrite = colorWrite;
    const layered = polygonOffsetUnits !== undefined,
      offset = layered || material.polygonOffset,
      factor = layered ? 0 : material.polygonOffsetFactor,
      units = layered ? polygonOffsetUnits : material.polygonOffsetUnits;
    this.polygon = this.capability(offset, this.polygon, gl.POLYGON_OFFSET_FILL);
    if (offset && (this.polygonFactor !== factor || this.polygonUnits !== units))
      gl.polygonOffset(factor, units);
    this.polygonFactor = factor;
    this.polygonUnits = units;
  }
}
