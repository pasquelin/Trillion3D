// The browser a page finds in the bench's Node process: one window of the bench's display size,
// a document with the page's own elements, a frame clock the bench advances itself (no display
// paces it), the engine's workers on threads and its files read from disk. Nothing is drawn on
// screen and no browser runs.
import { FakeCanvas } from './canvas.ts'
import { FakeElement, FakeOption } from './elements.ts'
import { BenchImage, BenchOffscreenCanvas, createImageBitmap } from './images.ts'
import { installFileFetch } from './fileFetch.ts'
import { installWorker } from './worker.ts'

/** The display a bench draws for: image pixels and their density. */
export type BenchDisplay = { width: number; height: number; ratio: number }

/** An input event with the fields the engine's controls read. */
class InputEvent extends Event {
  constructor(type: string, init: Record<string, unknown> = {}) {
    super(type, { bubbles: true, cancelable: true })
    Object.assign(this, { button: 0, buttons: 0, clientX: 0, clientY: 0, ...init })
  }
  preventDefault() {}
}

/** Keys a page reads and writes for its own preferences, kept for this run. */
class MemoryStorage {
  #held = new Map<string, string>()
  getItem = (key: string) => this.#held.get(key) ?? null
  setItem = (key: string, value: string) => void this.#held.set(key, String(value))
  removeItem = (key: string) => void this.#held.delete(key)
  clear = () => this.#held.clear()
}

const listeners = (target: EventTarget) => ({
  addEventListener: target.addEventListener.bind(target),
  removeEventListener: target.removeEventListener.bind(target),
  dispatchEvent: target.dispatchEvent.bind(target),
})

/**
 * Installs the page's browser on this process's global: `canvasIds` are the canvases the page
 * declares (`<canvas id>`), `elementIds` its other elements. Returns the canvases, the window and
 * `frame(time)`, which runs every animation frame callback asked before it, at `time`.
 */
export function installBrowser(
  display: BenchDisplay,
  address: string,
  canvasIds: readonly string[],
  elementIds: readonly string[],
) {
  installFileFetch()
  installWorker()
  const css = { width: display.width / display.ratio, height: display.height / display.ratio }
  const scope = globalThis as unknown as Record<string, unknown>
  const windowEvents = new EventTarget(),
    documentEvents = new EventTarget()
  const document: Record<string, unknown> = { ...listeners(documentEvents) }
  const element = (tag: string) =>
    tag.toLowerCase() === 'canvas'
      ? new FakeCanvas(document, css, display.ratio)
      : new FakeElement(tag.toUpperCase(), document)
  const byId = new Map<string, FakeElement>()
  for (const id of canvasIds) byId.set(id, Object.assign(element('canvas'), { id }))
  for (const id of elementIds)
    if (!byId.has(id)) byId.set(id, Object.assign(element('div'), { id }))
  const body = element('body'),
    head = element('head'),
    root = element('html')
  for (const node of byId.values()) body.appendChild(node)
  root.append(head, body)
  root.setAttribute('lang', 'en')
  Object.assign(document, {
    defaultView: scope,
    documentElement: root,
    body,
    head,
    baseURI: address,
    URL: address,
    readyState: 'complete',
    visibilityState: 'visible',
    hidden: false,
    fonts: { ready: Promise.resolve() },
    timeline: { currentTime: 0 },
    hasFocus: () => true,
    createElement: element,
    createElementNS: (_ns: string, tag: string) => element(tag),
    createTextNode: (text: string) => Object.assign(element('#text'), { textContent: text }),
    getElementById: (id: string) => byId.get(id) ?? root.querySelector(`#${id}`),
    querySelector: (selector: string) => root.querySelector(selector),
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
  })
  let next = 1
  let asked = new Map<number, FrameRequestCallback>()
  const observer = class {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return []
    }
  }
  Object.assign(scope, listeners(windowEvents), {
    window: scope,
    self: scope,
    document,
    location: new URL(address),
    devicePixelRatio: display.ratio,
    innerWidth: css.width,
    innerHeight: css.height,
    screen: {
      width: css.width,
      height: css.height,
      availWidth: css.width,
      availHeight: css.height,
    },
    localStorage: new MemoryStorage(),
    sessionStorage: new MemoryStorage(),
    matchMedia: (query: string) => ({
      matches: false,
      media: query,
      ...listeners(new EventTarget()),
    }),
    getComputedStyle: (node: FakeElement) => node.style,
    ResizeObserver: observer,
    IntersectionObserver: observer,
    MutationObserver: observer,
    HTMLElement: FakeElement,
    Element: FakeElement,
    Node: FakeElement,
    HTMLCanvasElement: FakeCanvas,
    Option: FakeOption,
    Image: BenchImage,
    OffscreenCanvas: BenchOffscreenCanvas,
    createImageBitmap,
    PointerEvent: InputEvent,
    MouseEvent: InputEvent,
    WheelEvent: InputEvent,
    KeyboardEvent: InputEvent,
    requestAnimationFrame: (callback: FrameRequestCallback) => (asked.set(next, callback), next++),
    cancelAnimationFrame: (id: number) => void asked.delete(id),
  })
  const canvases = [...byId.values()].filter(
    (node): node is FakeCanvas => node instanceof FakeCanvas,
  )
  return {
    canvases,
    window: windowEvents,
    document: documentEvents,
    InputEvent,
    /** Runs the callbacks asked before this frame, at `time` ms; those they ask wait for the next. */
    frame(time: number) {
      ;(document.timeline as { currentTime: number }).currentTime = time
      const due = asked
      asked = new Map()
      for (const callback of due.values()) callback(time)
      return due.size
    },
  }
}

export type BenchBrowser = ReturnType<typeof installBrowser>
