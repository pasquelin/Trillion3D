import type { ClusterDrawMesh } from '../../cluster/batchMesh.ts';

type Material = Exclude<ClusterDrawMesh['material'], unknown[]>;

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
  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
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
    this.blend = this.capability(material.transparent, this.blend, gl.BLEND);
    if (material.transparent) {
      gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
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
