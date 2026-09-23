import { Object3D } from '../object/object3d.ts';
import { Vector3, readVec3, type Vec3Input } from '../math/vector3.ts';
import { Ray } from '../math/volumes.ts';

/** A named view: where the eye is, what it looks at, and optionally its field. */
export interface CameraPose {
  /** Where the eye stands. */
  position: Vec3Input;
  /** The point the eye looks at. */
  target: Vec3Input;
  /** How wide the eye sees, top to bottom, in degrees. */
  fov?: number;
}

/** What `camera.perspective` and `camera.orthographic` accept. */
export interface CameraParameters {
  /** How wide a perspective camera sees, top to bottom, in degrees. */
  fov?: number;
  /** The closest distance the camera draws. */
  near?: number;
  /** The farthest distance the camera draws. */
  far?: number;
  /** Width divided by height of the picture. */
  aspect?: number;
  /** Magnification: 2 shows everything twice as big. */
  zoom?: number;
  /** Left edge of an orthographic camera's view box. */
  left?: number;
  /** Right edge of an orthographic camera's view box. */
  right?: number;
  /** Top edge of an orthographic camera's view box. */
  top?: number;
  /** Bottom edge of an orthographic camera's view box. */
  bottom?: number;
}

/** The optics a camera declares; a write redraws the frame, nothing more to call. */
const OPTICS = ['fov', 'near', 'far', 'aspect', 'zoom', 'left', 'right', 'top', 'bottom'] as const;
type Optic = (typeof OPTICS)[number];

/**
 * The eye a world draws from: a node of the scene, looking down its `-z`, and the optics the
 * engine composes its own projection from (`engineCamera.ts`). A write reaches the world's frame.
 */
export class Camera extends Object3D {
  /** Always `true`: tells a camera apart from any other object. */
  readonly isCamera = true as const;
  /** The optics' values, behind the properties of the same names. */
  readonly _optics: Record<Optic, number>;
  /** Field of view top to bottom, in degrees; a write redraws. */
  declare fov: number;
  /** Nearest distance drawn. */
  declare near: number;
  /** Farthest distance drawn. */
  declare far: number;
  /** Width over height of the picture. */
  declare aspect: number;
  /** Magnification of the view. */
  declare zoom: number;
  /** Left edge of the orthographic box. */
  declare left: number;
  /** Right edge of the orthographic box. */
  declare right: number;
  /** Top edge of the orthographic box. */
  declare top: number;
  /** Bottom edge of the orthographic box. */
  declare bottom: number;

  /** `'perspective'` makes far things small; `'orthographic'` keeps every size. */
  readonly projection: 'perspective' | 'orthographic';
  constructor(projection: 'perspective' | 'orthographic', p: CameraParameters = {}) {
    super();
    this.projection = projection;
    this.type = projection === 'perspective' ? 'PerspectiveCamera' : 'OrthographicCamera';
    this._optics = {
      fov: p.fov ?? 50,
      near: p.near ?? 0.1,
      far: p.far ?? 2000,
      aspect: p.aspect ?? 1,
      zoom: p.zoom ?? 1,
      left: p.left ?? -1,
      right: p.right ?? 1,
      top: p.top ?? 1,
      bottom: p.bottom ?? -1,
    };
  }
  protected override get looksDownNegativeZ() {
    return true;
  }
  /** Kept for pages written against a renderer that needs it: every optic write already redraws. */
  updateProjectionMatrix() {
    this._link?.pose(this);
  }
  /**
   * The world ray through a point of the picture, in the engine's own projection
   * (`engineCamera.ts`): from the eye along the view for a perspective camera, straight down the
   * view from the box for an orthographic one. Its direction is a unit vector.
   * @param x - Left edge −1 to right edge 1. @param y - Bottom −1 to top 1.
   * @param aspect - Width over height of the picture drawn. @param out - The ray written.
   */
  rayThrough(x: number, y: number, aspect: number, out = new Ray()) {
    this.updateWorldMatrix(true, false);
    const m = this.matrixWorld;
    if (this.projection === 'perspective') {
      const t = Math.tan((this.fov * Math.PI) / 360) / this.zoom;
      out.origin.setFromMatrixPosition(m);
      out.direction.set(x * t * aspect, y * t, -1);
    } else {
      const w = (this.right - this.left) / 2 / this.zoom,
        h = (this.top - this.bottom) / 2 / this.zoom;
      const at = new Vector3(
        (this.right + this.left) / 2 + x * w,
        (this.top + this.bottom) / 2 + y * h,
        0,
      );
      out.origin.copy(at.applyMatrix4(m));
      out.direction.set(0, 0, -1);
    }
    out.direction.transformDirection(m);
    return out;
  }
  /** Puts the eye at `pose.position`, looking at `pose.target`, at the field it names. */
  set(pose: CameraPose) {
    if (pose.fov !== undefined) this.fov = pose.fov;
    this.position.set(...readVec3(pose.position));
    this.lookAt(...readVec3(pose.target));
  }
}

for (const optic of OPTICS)
  Object.defineProperty(Camera.prototype, optic, {
    get(this: Camera) {
      return this._optics[optic];
    },
    set(this: Camera, value: number) {
      this._optics[optic] = value;
      this.updateProjectionMatrix();
    },
  });
