import { EffectPass } from './chain.ts'
import { Color, type ColorInput } from '../math/color.ts'
import { listen } from '../observed.ts'
import type { Object3D } from '../object/object3d.ts'

/** What a page may pass to `effect.outline`. */
export interface OutlineOptions {
  /** The objects outlined, each with its subtree; none outlines nothing and costs nothing. */
  objects?: readonly Object3D[]
  /** The line's colour, shown as it is: drawn over the display image, after tone mapping. */
  color?: ColorInput
  /** The line's width outside the silhouette, in CSS pixels. */
  thickness?: number
}

/**
 * The defaults: an orange line of 2 CSS pixels, around no object. None is read from a scene; all
 * are the page's to change.
 *
 * - color `#ff9f1c`, declared: the selection orange editors use, which few lit surfaces share.
 *   Shown as written: the line is laid over the display image, past exposure and tone curve.
 * - thickness 2, declared: a line read at a glance without hiding the edge it follows. Sensitivity:
 *   linear in width and quadratic in nothing — each pixel of the image reads `2·⌈t·dpr⌉ + 1`
 *   identifiers across and as many line widths down (`outlineWgsl.ts`), so the pass's cost grows
 *   with the width, not its square.
 */
const OUTLINE_DEFAULTS = { color: 0xff9f1c, thickness: 2 }

/** The widest line, in CSS pixels: past it the two scans of each pixel outgrow the frame. */
const OUTLINE_MAX_THICKNESS = 32

const checkThickness = (value: number) => {
  if (!(value > 0 && value <= OUTLINE_MAX_THICKNESS))
    throw new RangeError(`OUTLINE_THICKNESS:${value}`)
  return value
}
const checkObjects = (value: readonly Object3D[]) => {
  if (!Array.isArray(value)) throw new TypeError('OUTLINE_OBJECTS')
  return Object.freeze([...value])
}

/**
 * A line around the selected objects, as an editor draws its selection: the silhouette each
 * object, with its subtree, shows on screen — the parts hidden behind another surface are not
 * outlined —, widened by `thickness` CSS pixels and laid in `color` over the display image. It
 * follows the objects as they are drawn: a runtime mesh or a node of a loaded model, at whatever
 * detail the cut holds. With no object, no pass runs and nothing is allocated.
 */
export class Outline extends EffectPass {
  readonly kind = 'outline'
  readonly stage = 'after-tone-mapping'
  /** The line's colour; a write (`outline.color.set('#fff')`) shows on the next frame. */
  readonly color: Color
  private chosen: readonly Object3D[]
  private width: number
  constructor(options: OutlineOptions = {}) {
    super()
    this.chosen = checkObjects(options.objects ?? [])
    this.width = checkThickness(options.thickness ?? OUTLINE_DEFAULTS.thickness)
    this.color = new Color(options.color ?? OUTLINE_DEFAULTS.color)
    listen(this.color, () => this.changed())
  }
  /** The objects outlined, each with its subtree; a write replaces the list, kept as a copy. */
  get objects(): readonly Object3D[] {
    return this.chosen
  }
  set objects(value: readonly Object3D[]) {
    this.chosen = checkObjects(value)
    this.changed()
  }
  /** The line's width outside the silhouette, in CSS pixels; above 0, up to 32. */
  get thickness() {
    return this.width
  }
  set thickness(value: number) {
    this.width = checkThickness(value)
    this.changed()
  }
  /** No object to outline: the engine passes it by. */
  override get idle() {
    return !this.chosen.length
  }
}
