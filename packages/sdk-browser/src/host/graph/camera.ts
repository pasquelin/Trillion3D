/**
 * The eye of the engine's own graph: a node looking down its `-z`, the optics it declares and the
 * projection the reference composes from them, number for number.
 */
import { Matrix4 } from '../../../../sdk-core/src/world/math/matrix4.ts';
import { GraphNode } from './node.ts';

/** The box an orthographic camera sees, from its centre. */
type Frame = { left: number; right: number; top: number; bottom: number };

/**
 * An eye: a node looking down its `-z`, the optics it declares, and the projection a renderer
 * drawing with them would compose — in the reference's depth convention, finite far plane.
 */
export class GraphCamera extends GraphNode {
  /** Always `true`: tells a camera apart. */
  readonly isCamera = true as const;
  /** Present on a perspective camera. */
  declare readonly isPerspectiveCamera?: true;
  /** Present on an orthographic camera. */
  declare readonly isOrthographicCamera?: true;
  /** The inverse of the world matrix, kept beside it. */
  readonly matrixWorldInverse = new Matrix4();
  /** The projection the optics compose. */
  readonly projectionMatrix = new Matrix4();
  /** Its inverse. */
  readonly projectionMatrixInverse = new Matrix4();
  /** Magnification. */
  zoom = 1;
  /** Field of view top to bottom, in degrees; a perspective camera's. */
  fov = 50;
  /** Width over height; a perspective camera's. */
  aspect = 1;
  /** Nearest distance drawn. */
  near = 0.1;
  /** Farthest distance drawn. */
  far = 2000;
  /** The box an orthographic camera sees; absent on a perspective one. */
  declare frame?: Frame;
  /** A perspective camera, or an orthographic one when `frame` is given. */
  constructor(
    optics: { fov?: number; aspect?: number; near?: number; far?: number } = {},
    frame?: Frame,
  ) {
    super();
    if (frame) {
      this.type = 'OrthographicCamera';
      this.frame = { ...frame };
      this.near = optics.near ?? 0.1;
      this.far = optics.far ?? 2000;
      Object.assign(this, { isOrthographicCamera: true });
    } else {
      this.type = 'PerspectiveCamera';
      this.fov = optics.fov ?? 50;
      this.aspect = optics.aspect ?? 1;
      this.near = optics.near ?? 0.1;
      this.far = optics.far ?? 2000;
      Object.assign(this, { isPerspectiveCamera: true });
    }
    this.updateProjectionMatrix();
  }
  protected override get looksDownNegativeZ() {
    return true;
  }
  /** Composes the projection from the optics, as the reference's renderer reads it. */
  updateProjectionMatrix() {
    const near = this.near,
      far = this.far;
    let left: number, right: number, top: number, bottom: number;
    if (this.frame) {
      const { frame, zoom } = this;
      const dx = (frame.right - frame.left) / (2 * zoom),
        dy = (frame.top - frame.bottom) / (2 * zoom);
      const cx = (frame.right + frame.left) / 2,
        cy = (frame.top + frame.bottom) / 2;
      left = cx - dx;
      right = cx + dx;
      top = cy + dy;
      bottom = cy - dy;
      const w = 1.0 / (right - left),
        h = 1.0 / (top - bottom),
        p = 1.0 / (far - near);
      // prettier-ignore
      this.projectionMatrix.set(
        2 * w, 0, 0, -(right + left) * w,
        0, 2 * h, 0, -(top + bottom) * h,
        0, 0, -2 * p, -(far + near) * p,
        0, 0, 0, 1,
      );
    } else {
      top = (near * Math.tan((Math.PI / 180) * 0.5 * this.fov)) / this.zoom;
      const height = 2 * top,
        width = this.aspect * height;
      left = -0.5 * width;
      right = left + width;
      bottom = top - height;
      const x = (2 * near) / (right - left),
        y = (2 * near) / (top - bottom);
      const a = (right + left) / (right - left),
        b = (top + bottom) / (top - bottom);
      const c = -(far + near) / (far - near),
        d = (-2 * far * near) / (far - near);
      // prettier-ignore
      this.projectionMatrix.set(
        x, 0, a, 0,
        0, y, b, 0,
        0, 0, c, d,
        0, 0, -1, 0,
      );
    }
    this.projectionMatrixInverse.copy(this.projectionMatrix).invert();
  }
  override updateMatrixWorld(force = false) {
    super.updateMatrixWorld(force);
    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }
  override updateWorldMatrix(ancestors: boolean, descendants: boolean) {
    super.updateWorldMatrix(ancestors, descendants);
    this.matrixWorldInverse.copy(this.matrixWorld).invert();
  }
  protected override blank(): this {
    return new GraphCamera({}, this.frame) as this;
  }
  override copy(source: GraphNode, recursive = true) {
    super.copy(source, recursive);
    const camera = source as GraphCamera;
    this.matrixWorldInverse.copy(camera.matrixWorldInverse);
    this.projectionMatrix.copy(camera.projectionMatrix);
    this.projectionMatrixInverse.copy(camera.projectionMatrixInverse);
    this.zoom = camera.zoom;
    this.fov = camera.fov;
    this.aspect = camera.aspect;
    this.near = camera.near;
    this.far = camera.far;
    if (camera.frame) this.frame = { ...camera.frame };
    return this;
  }
}
