// The page elements the bench host gives a page in Node: enough of an element for the examples' kit
// to build its panels without drawing them (the canvas is `canvas.ts`).

import { matches, selectAll } from './selector.ts';

/** Classes of a fake element, as `classList` answers. */
class ClassList extends Set<string> {
  contains = (name: string) => this.has(name);
  remove = (...names: string[]) => names.forEach((name) => this.delete(name));
  toggle = (name: string, on = !this.has(name)) => (on ? this.add(name) : this.delete(name), on);
  replace = (from: string, to: string) => (this.delete(from), this.add(to), true);
}

/** A style declaration that keeps what it is given. */
class Style {
  [property: string]: unknown;
  setProperty(name: string, value: string) {
    this[name] = value;
  }
  getPropertyValue(name: string) {
    return String(this[name] ?? '');
  }
  removeProperty(name: string) {
    delete this[name];
  }
}

/** An element that holds its attributes, children and listeners, and draws nothing. */
export class FakeElement extends EventTarget {
  readonly style = new Style();
  readonly classList = new ClassList();
  readonly dataset: Record<string, string> = {};
  readonly attributes = new Map<string, string>();
  readonly children: FakeElement[] = [];
  parentElement: FakeElement | null = null;
  textContent = '';
  innerHTML = '';
  value = '';
  checked = false;
  disabled = false;
  hidden = false;
  id = '';
  readonly tagName: string;
  readonly ownerDocument: unknown;
  constructor(tagName: string, ownerDocument: unknown) {
    super();
    this.tagName = tagName;
    this.ownerDocument = ownerDocument;
  }
  get nodeName() {
    return this.tagName;
  }
  get valueAsNumber() {
    return Number(this.value);
  }
  set valueAsNumber(next: number) {
    this.value = String(next);
  }
  get parentNode() {
    return this.parentElement;
  }
  get childNodes() {
    return this.children;
  }
  get firstChild() {
    return this.children[0] ?? null;
  }
  get isConnected() {
    return true;
  }
  get clientWidth() {
    return 0;
  }
  get clientHeight() {
    return 0;
  }
  appendChild<T extends FakeElement>(child: T) {
    child.remove();
    this.children.push(child);
    child.parentElement = this;
    return child;
  }
  append(...nodes: unknown[]) {
    for (const node of nodes) if (node instanceof FakeElement) this.appendChild(node);
  }
  prepend(...nodes: unknown[]) {
    this.append(...nodes);
  }
  insertBefore<T extends FakeElement>(child: T) {
    return this.appendChild(child);
  }
  replaceChildren(...nodes: unknown[]) {
    for (const child of this.children.splice(0)) child.parentElement = null;
    this.append(...nodes);
  }
  removeChild<T extends FakeElement>(child: T) {
    child.remove();
    return child;
  }
  remove() {
    const siblings = this.parentElement?.children;
    if (siblings) siblings.splice(siblings.indexOf(this), 1);
    this.parentElement = null;
  }
  setAttribute(name: string, value: string) {
    this.attributes.set(name, String(value));
    if (name === 'id') this.id = String(value);
  }
  getAttribute(name: string) {
    return this.attributes.get(name) ?? null;
  }
  hasAttribute(name: string) {
    return this.attributes.has(name);
  }
  removeAttribute(name: string) {
    this.attributes.delete(name);
  }
  toggleAttribute(name: string, on = !this.attributes.has(name)) {
    if (on) this.attributes.set(name, '');
    else this.attributes.delete(name);
    return on;
  }
  /** The kit's overlay draws in a shadow root of its own (`site/examples/kit/overlay.ts`). */
  attachShadow() {
    const root = new FakeElement('#shadow-root', this.ownerDocument);
    root.parentElement = null;
    (root as { host?: FakeElement }).host = this;
    return root;
  }
  getRootNode(): FakeElement {
    return this.parentElement ? this.parentElement.getRootNode() : this;
  }
  get className() {
    return [...this.classList].join(' ');
  }
  set className(names: string) {
    this.classList.clear();
    for (const name of String(names).split(/\s+/)) if (name) this.classList.add(name);
  }
  get firstElementChild(): FakeElement | null {
    return this.children[0] ?? null;
  }
  get lastElementChild(): FakeElement | null {
    return this.children.at(-1) ?? null;
  }
  get childElementCount() {
    return this.children.length;
  }
  querySelector(selector: string): FakeElement | null {
    return selectAll(this, selector)[0] ?? null;
  }
  querySelectorAll(selector: string): FakeElement[] {
    return selectAll(this, selector);
  }
  matches(selector: string) {
    return matches(this, selector);
  }
  closest(selector: string): FakeElement | null {
    return matches(this, selector) ? this : (this.parentElement?.closest(selector) ?? null);
  }
  contains(other: unknown) {
    return other === this;
  }
  getBoundingClientRect() {
    const width = this.clientWidth,
      height = this.clientHeight;
    return { left: 0, top: 0, x: 0, y: 0, width, height, right: width, bottom: height };
  }
  focus() {}
  blur() {}
  click() {}
  setPointerCapture() {}
  releasePointerCapture() {}
  hasPointerCapture() {
    return false;
  }
}

/** A `<select>`'s option: `new Option(text, value)`. */
export class FakeOption extends FakeElement {
  constructor(text = '', value = text) {
    super('OPTION', globalThis.document);
    this.textContent = text;
    this.value = value;
  }
}
