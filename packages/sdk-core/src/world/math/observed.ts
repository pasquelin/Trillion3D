/**
 * The one change channel every engine-owned value shares. A vector, a rotation or a colour held by
 * a scene object tells its owner when it is written, so a page that moves an object never has to
 * name the frame it wants redrawn: the world hears the write and schedules one. A value nobody
 * holds carries no listener, and a write then costs one null test.
 */
export class Observed {
  /** Called after every write; set by the owner, never by the page. */
  _onChange: (() => void) | null = null;

  /** Tells the owner, when there is one. */
  protected _changed(): this {
    this._onChange?.();
    return this;
  }
}

/** Numbers kept in `elements`, the first three read and written as `x`, `y`, `z`. */
export class ObservedComponents extends Observed {
  readonly elements: Float64Array;
  constructor(elements: Float64Array) {
    super();
    this.elements = elements;
  }
  get x() {
    return this.elements[0];
  }
  set x(value: number) {
    this.elements[0] = value;
    this._changed();
  }
  get y() {
    return this.elements[1];
  }
  set y(value: number) {
    this.elements[1] = value;
    this._changed();
  }
  get z() {
    return this.elements[2];
  }
  set z(value: number) {
    this.elements[2] = value;
    this._changed();
  }
}

/** Every listener `listen` hung on a value, called in the order they were added. */
const heard = new WeakMap<Observed, Set<() => void>>();

/** Adds `listener` after whatever the value already notified, so two owners both hear it; the
 *  returned function removes that listener alone. */
export function listen(value: Observed, listener: () => void): () => void {
  const listeners = heard.get(value) ?? hear(value);
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Makes `value` call every listener of its set, the one it already had first. */
function hear(value: Observed) {
  const listeners = new Set<() => void>();
  if (value._onChange) listeners.add(value._onChange);
  value._onChange = () => {
    for (const listener of listeners) listener();
  };
  heard.set(value, listeners);
  return listeners;
}
