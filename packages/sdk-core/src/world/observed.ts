import { createListeners, type Listeners } from '../runtime/listeners.ts'

/**
 * The one change channel every engine-owned value shares. A vector, a rotation or a colour held by
 * a scene object tells its owner when it is written, so a page that moves an object never has to
 * name the frame it wants redrawn: the world hears the write and schedules one. A value nobody
 * holds carries no listener, and a write then costs one null test.
 */
export class Observed {
  /** Who hears every write, once an owner listens (`listen`); never the page. */
  _changes: Listeners | null = null

  /** Tells the owners, when there are any. */
  protected _changed(): this {
    this._changes?.emit()
    return this
  }
}

/** Numbers kept in `elements`, the first three read and written as `x`, `y`, `z`. */
export class ObservedComponents extends Observed {
  readonly elements: Float64Array
  constructor(elements: Float64Array) {
    super()
    this.elements = elements
  }
  /**
   * The numbers live in `store` from now on, the current ones copied in: an owner writing values
   * by the thousand (the physics' drawn poses) keeps them in one flat array, with no object on
   * the way. `store` is as long as `elements`; sharing a fresh copy gives the numbers back.
   */
  _share(store: Float64Array) {
    store.set(this.elements)
    ;(this as { elements: Float64Array }).elements = store
  }
  get x() {
    return this.elements[0]
  }
  set x(value: number) {
    this.elements[0] = value
    this._changed()
  }
  get y() {
    return this.elements[1]
  }
  set y(value: number) {
    this.elements[1] = value
    this._changed()
  }
  get z() {
    return this.elements[2]
  }
  set z(value: number) {
    this.elements[2] = value
    this._changed()
  }
}

/** Hears `value`'s writes after the ones it already tells, so two owners both hear it. A
 *  listener already held is not held twice. */
export function listen(value: Observed, listener: () => void) {
  ;(value._changes ??= createListeners()).subscribe(listener)
}

/** Takes `listener` off the value, the other owners kept. */
export function unlisten(value: Observed, listener: () => void) {
  value._changes?.unsubscribe(listener)
}
