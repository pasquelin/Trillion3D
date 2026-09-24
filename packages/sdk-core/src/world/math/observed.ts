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

/** The listeners chained on a value, and the one call that runs them in order. */
const chains = new WeakMap<Observed, { call: () => void; listeners: (() => void)[] }>();

/** Chains `listener` after whatever the value already notified, so two owners both hear it. A
 *  listener already chained is not chained twice. */
export function listen(value: Observed, listener: () => void) {
  const current = value._onChange;
  if (current === listener) return;
  if (!current) {
    value._onChange = listener;
    return;
  }
  let chain = chains.get(value);
  if (chain?.call !== current) {
    const listeners = [current];
    chain = {
      listeners,
      call: () => {
        for (const heard of listeners) heard();
      },
    };
    chains.set(value, chain);
    value._onChange = chain.call;
  }
  if (!chain.listeners.includes(listener)) chain.listeners.push(listener);
}

/** Takes `listener` off the value, the other owners chained with it kept. */
export function unlisten(value: Observed, listener: () => void) {
  const current = value._onChange;
  if (current === listener) {
    value._onChange = null;
    return;
  }
  const chain = chains.get(value);
  if (chain?.call !== current) return;
  const at = chain.listeners.indexOf(listener);
  if (at >= 0) chain.listeners.splice(at, 1);
}
