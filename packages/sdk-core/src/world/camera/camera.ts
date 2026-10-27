import { Object3D } from '../object/object3d.ts'
import { readVec3, Vector3, type Vec3Input } from '../math/vector3.ts'
import { listen } from '../observed.ts'
import { Ray } from '../math/volumes.ts'
import { Matrix4 } from '../math/matrix4.ts'
import {
  conjugateQuaternion,
  rotateByQuaternion,
} from '../../../../math/src/quaternion/quaternion.ts'
import { referenceProjection } from './referenceProjection.ts'
import {
  DEFAULT_NEAR,
  drawnView,
  perspectiveSlope,
} from '../../../../math/src/projection/camera.ts'
import {
  hasClipPlane,
  resolveClipPlane,
  resolveViewList,
  resolveViewOwner,
  type ClipPlane,
} from '../../contracts/viewOptions.ts'
import { NO_VIEW_SET, type ViewSet } from './viewSet.ts'

const view = new Float64Array(4)
/** `setViewTarget`'s offset, and the inverse of the rotation it turns it by. */
const offset = new Float64Array(3),
  inverse = new Float64Array(4)
/** The world point `set` aims at, in the parent's frame. */
const aimed = new Vector3()

/** A named view: where the eye is, what it looks at, and optionally its field. */
export interface CameraPose {
  /** Where the eye stands. */
  position: Vec3Input
  /** The point the eye looks at. */
  target: Vec3Input
  /** How wide the eye sees, top to bottom, in degrees. */
  fov?: number
}

/** What `camera.perspective` and `camera.orthographic` accept. */
export interface CameraParameters {
  /** How wide a perspective camera sees, top to bottom, in degrees. */
  fov?: number
  /** The closest distance the camera draws. */
  near?: number
  /** The farthest distance an orthographic camera draws; a perspective one draws to infinity, and
   *  reads `far` for the ranges that follow its view (the shadow range). */
  far?: number
  /** Width divided by height of the picture. */
  aspect?: number
  /** Magnification: 2 shows everything twice as big. */
  zoom?: number
  /** Left edge of an orthographic camera's view box. */
  left?: number
  /** Right edge of an orthographic camera's view box. */
  right?: number
  /** Top edge of an orthographic camera's view box. */
  top?: number
  /** Bottom edge of an orthographic camera's view box. */
  bottom?: number
  /** An orthographic camera keeps its box's height and centre and takes its width from the
   *  picture's shape, so a resized canvas never stretches the drawing. On by default. */
  fitAspect?: boolean
}

/** The optics a camera declares; a write redraws the frame, nothing more to call. */
const OPTICS = ['fov', 'near', 'far', 'aspect', 'zoom', 'left', 'right', 'top', 'bottom'] as const
type Optic = (typeof OPTICS)[number]

/**
 * The eye a world draws from: a node of the scene, looking down its `-z`, and the optics the
 * engine composes its own projection from (`engineCamera.ts`). A write reaches the world's frame.
 */
export class Camera extends Object3D {
  /** Always `true`: tells a camera apart from any other object. */
  readonly isCamera = true as const
  /** The optics' values, behind the properties of the same names. */
  readonly _optics: Record<Optic, number>
  /** Field of view top to bottom, in degrees; a write redraws. */
  declare fov: number
  /** Nearest distance drawn. */
  declare near: number
  /** Farthest distance an orthographic camera draws; a perspective one draws to infinity (see
   *  `CameraParameters.far`). */
  declare far: number
  /** Width over height of the picture. */
  declare aspect: number
  /** Magnification of the view. */
  declare zoom: number
  /** Left edge of the orthographic box. */
  declare left: number
  /** Right edge of the orthographic box. */
  declare right: number
  /** Top edge of the orthographic box. */
  declare top: number
  /** Bottom edge of the orthographic box. */
  declare bottom: number
  private _fitAspect: boolean
  /** The view's plane and lists, replaced whole at each write (`ViewSet`). */
  private _set: ViewSet = NO_VIEW_SET
  /**
   * The point the camera frames, as its offset from the eye in the camera's own frame (a point
   * straight ahead is at `z` = −distance), so it follows the camera when a rig moves it; zero, the
   * default, frames none. An orthographic view's sun shadows centre on it (`shadowOrthoProjectViewOrigin`).
   * `set`, `setViewTarget` and the orbit, trackball and pan-zoom controls write it. A write redraws.
   */
  readonly viewTarget = new Vector3()

  /** `'perspective'` makes far things small; `'orthographic'` keeps every size. */
  readonly projection: 'perspective' | 'orthographic'
  /** The matrices a renderer reads, made at their first read (`projectionMatrix`). */
  declare private _projectionMatrix?: Matrix4
  declare private _matrixWorldInverse?: Matrix4
  constructor(projection: 'perspective' | 'orthographic', p: CameraParameters = {}) {
    super()
    this.projection = projection
    this.type = projection === 'perspective' ? 'PerspectiveCamera' : 'OrthographicCamera'
    this._optics = {
      fov: p.fov ?? 50,
      near: p.near ?? DEFAULT_NEAR,
      far: p.far ?? 2000,
      aspect: p.aspect ?? 1,
      zoom: p.zoom ?? 1,
      left: p.left ?? -1,
      right: p.right ?? 1,
      top: p.top ?? 1,
      bottom: p.bottom ?? -1,
    }
    this._fitAspect = p.fitAspect ?? true
    listen(this.viewTarget, () => this._link?.pose(this))
  }
  /** An orthographic box as high as declared and as wide as the picture's shape makes it. */
  get fitAspect() {
    return this._fitAspect
  }
  set fitAspect(value: boolean) {
    this._fitAspect = value
    this.updateProjectionMatrix()
  }
  /** The plane that clips what this camera's view draws, `null` for none (the default): the side
   *  its `normal` points to is drawn, the rest is cut. It takes effect where the world was made
   *  with the project switch `cutClipPlane` on; a view with a plane is drawn without temporal
   *  jitter. A write redraws. */
  get clipPlane(): ClipPlane | null {
    const [x, y, z, w] = this._set.clipPlane
    return hasClipPlane(this._set.clipPlane)
      ? { base: [x * w, y * w, z * w], normal: [x, y, z] }
      : null
  }
  set clipPlane(plane: ClipPlane | null) {
    this.write({ clipPlane: resolveClipPlane(plane) })
  }
  /** Objects this camera's view does not draw, each with everything under it; none by default.
   *  A write redraws. */
  get hidden(): readonly Object3D[] {
    return this._set.hidden
  }
  set hidden(objects: Iterable<Object3D>) {
    this.write({ hidden: resolveViewList(objects, 'hidden') })
  }
  /** The only objects this camera's view draws, each with everything under it; `null`, the
   *  default, draws every object, and an empty list draws none. `hidden` wins over it. A write
   *  redraws. */
  get showOnly(): readonly Object3D[] | null {
    return this._set.showOnly
  }
  set showOnly(objects: Iterable<Object3D> | null) {
    this.write({ showOnly: objects === null ? null : resolveViewList(objects, 'showOnly') })
  }
  /** The node this camera's view belongs to, `null` (the default) for none: the objects that are the
   *  owner or under it are owned by the view, and hide from it when they set `ownerNoSee`, while an
   *  object that sets `onlyOwnerSee` is drawn for the views that own it alone. A write redraws. */
  get owner(): Object3D | null {
    return this._set.owner
  }
  set owner(object: Object3D | null) {
    this.write({ owner: resolveViewOwner(object) })
  }
  /** What the engine reads of the view beside the eye (`ViewSet`); the engine's own camera takes
   *  a page camera's by this setter (`copyWorldCamera`), a write no one hears. */
  get _viewSet(): ViewSet {
    return this._set
  }
  set _viewSet(set: ViewSet) {
    this._set = set
  }
  private write(change: Partial<ViewSet>) {
    this._set = Object.freeze({ ...this._set, ...change })
    this._link?.pose(this)
  }
  protected override get looksDownNegativeZ() {
    return true
  }
  protected override blank(): this {
    return new Camera(this.projection) as this
  }
  /** Takes `source`'s node values and, from a camera, its optics; its own `projection` stays. */
  override copy(source: Object3D, recursive = true) {
    super.copy(source, recursive)
    if (!(source instanceof Camera)) return this
    ;(this as { _optics: Camera['_optics'] })._optics = { ...source._optics }
    this._fitAspect = source.fitAspect
    this._set = source._set
    this.viewTarget.copy(source.viewTarget)
    this.updateProjectionMatrix()
    return this
  }
  /** Composes `projectionMatrix` again; every optic write already does, and redraws. */
  updateProjectionMatrix() {
    if (this._projectionMatrix) referenceProjection(this._projectionMatrix, this)
    this._link?.pose(this)
  }
  /** The projection the optics compose, the engine's own: depth reversed onto [0, 1], 1 on the
   *  near plane (`referenceProjection.ts`); every optic write composes it again. */
  get projectionMatrix(): Matrix4 {
    return (this._projectionMatrix ??= referenceProjection(new Matrix4(), this))
  }
  /** The inverse of the world matrix as last composed, taken at each read: the view a renderer
   *  reads. */
  get matrixWorldInverse(): Matrix4 {
    return (this._matrixWorldInverse ??= new Matrix4()).copy(this.matrixWorld).invert()
  }
  /**
   * The world ray through a point of the picture, in the engine's own projection
   * (`engineCamera.ts`): from the eye along the view for a perspective camera, straight down the
   * view from the box for an orthographic one. Its direction is a unit vector.
   * @param x - Left edge −1 to right edge 1. @param y - Bottom −1 to top 1.
   * @param aspect - Width over height of the picture drawn. @param out - The ray written.
   */
  rayThrough(x: number, y: number, aspect: number, out = new Ray()) {
    this.updateWorldMatrix(true, false)
    const m = this.matrixWorld
    if (this.projection === 'perspective') {
      const t = perspectiveSlope(this.fov, this.zoom)
      out.origin.setFromMatrixPosition(m)
      out.direction.set(x * t * aspect, y * t, -1)
    } else {
      const [cx, cy, w, h] = drawnView(this, aspect, this.zoom, view)
      out.origin.set(cx + x * w, cy + y * h, 0).applyMatrix4(m)
      out.direction.set(0, 0, -1)
    }
    out.direction.transformDirection(m)
    return out
  }
  /** Puts the eye at `pose.position`, looking at `pose.target`, at the field it names; the target is
   *  the camera's `viewTarget`. */
  set(pose: CameraPose) {
    if (pose.fov !== undefined) this.fov = pose.fov
    this.position.set(...readVec3(pose.position))
    const aim = readVec3(pose.target)
    this.lookAt(...aim)
    // The target is a world point, as `lookAt`'s: in the parent's frame for `setViewTarget`.
    this.setViewTarget(this.parent ? this.parent.worldToLocal(aimed.set(...aim)) : aim)
  }
  /** Makes `target` the camera's `viewTarget`: the point, in the frame its `position` is written
   *  in (its parent's, the world's for a camera under none), as an offset from the eye in the
   *  camera's own frame, as the camera stands now; `null` frames none (a zero offset). */
  setViewTarget(target: Vec3Input | null) {
    if (!target) {
      this.viewTarget.set(0, 0, 0)
      return this
    }
    const [x, y, z] = readVec3(target),
      { position, quaternion, scale } = this
    // The pose's inverse, which is rigid but for the scale: take the position off, turn by the
    // inverse rotation, divide by the scale.
    conjugateQuaternion(inverse, quaternion.elements)
    rotateByQuaternion(offset, inverse, x - position.x, y - position.y, z - position.z)
    this.viewTarget.set(offset[0] / scale.x, offset[1] / scale.y, offset[2] / scale.z)
    return this
  }
}

for (const optic of OPTICS)
  Object.defineProperty(Camera.prototype, optic, {
    get(this: Camera) {
      return this._optics[optic]
    },
    set(this: Camera, value: number) {
      this._optics[optic] = value
      this.updateProjectionMatrix()
    },
  })
