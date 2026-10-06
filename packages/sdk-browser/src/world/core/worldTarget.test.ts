// #412: a world disposed takes out the canvas it made inside an element, never the host's own.
import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveWorldTarget } from './worldTarget.ts'

/** An element with its document, and a canvas that knows whether it is still attached. */
function page() {
  const attached = new Set<object>()
  const canvas = (): HTMLCanvasElement => {
    const made = {
      nodeName: 'CANVAS',
      style: {},
      getContext: () => null,
      remove: () => attached.delete(made),
    }
    return made as unknown as HTMLCanvasElement
  }
  const element = {
    nodeName: 'DIV',
    ownerDocument: { createElement: canvas },
    appendChild: (child: object) => attached.add(child),
  } as unknown as HTMLElement
  return { attached, element, canvas }
}

test('a canvas the world made inside an element leaves with it', () => {
  const { attached, element } = page()
  const { canvas, release } = resolveWorldTarget(element)
  assert.ok(attached.has(canvas), 'the made canvas fills the element')
  release()
  assert.equal(attached.has(canvas), false)
})

test('a canvas the host handed the world stays where it is', () => {
  const { attached, canvas } = page()
  const own = canvas()
  attached.add(own)
  const resolved = resolveWorldTarget(own)
  assert.equal(resolved.canvas, own)
  resolved.release()
  assert.ok(attached.has(own))
})
