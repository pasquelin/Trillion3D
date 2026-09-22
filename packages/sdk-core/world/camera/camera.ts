import { Object3D } from '../object/object3d.ts';
import { readVec3, type Vec3Input } from '../math/vector3.ts';

/** A named view: where the eye is, what it looks at, and optionally its field. */
export interface CameraPose {
  position: Vec3Input;
  target: Vec3Input;
  fov?: number;
}

/** What `camera.perspective` and `camera.orthographic` accept. */
export interface CameraParameters {
  fov?: number;
  near?: number;
  far?: number;
  aspect?: number;
  zoom?: number;
  left?: number;
  right?: number;
  top?: number;
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
  readonly isCamera = true as const;
  /** The optics' values, behind the properties of the same names. */
  readonly _optics: Record<Optic, number>;
  declare fov: number;
  declare near: number;
  declare far: number;
  declare aspect: number;
  declare zoom: number;
  declare left: number;
  declare right: number;
  declare top: number;
  declare bottom: number;

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
