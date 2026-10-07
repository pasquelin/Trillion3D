// The shader's readers of what the compiler writes: `proxyChild` (a child box on 8 bits per
// axis in its parent's bounds) and `proxyAlbedoOf` (an albedo on four bytes), shipped in
// `nodeWgsl.ts`, run on the CPU through `shaderRun` on the words the Rust twins wrote
// (`packages/math/golden/proxy_child_box.json`, `albedo_pack.json`). The twins' golden files
// hold the writers; here the readers decode those very words.
import test from 'node:test'
import assert from 'node:assert/strict'
import { PROXY_LEAF_OWNED } from '../../../sdk-core/src/scene/core/proxyLeaves.ts'
import { eachGolden } from '../../../math/src/golden.fixture.ts'
import { shaderRun } from '../texture/shaderRun.fixture.ts'
import { wgslModule } from '../../../math/src/wgsl/assemble.ts'
import { BOUNCE_NODE_WGSL, PROXY_ALBEDO_WGSL } from './nodeWgsl.ts'

type Vec3 = [number, number, number]
type Box = { low: Vec3; high: Vec3 }
type Child = { box: Box; offset: number; count: number; present: boolean; owned: boolean }
type Readers = {
  proxyChild: (node: number, slot: number, frame: Box) => Child
  proxyAlbedoOf: (index: number) => Vec3
}

/** The readers over a column of `words`: the structures they build, as plain objects. */
const readers = (words: number[]) =>
  shaderRun<Readers>(
    wgslModule(BOUNCE_NODE_WGSL, PROXY_ALBEDO_WGSL),
    ['proxyChild', 'proxyAlbedoOf', 'unorm8x3'],
    {
      proxy: { words, childrenWord: 0 },
      proxyAlbedo: words,
      Box: (low: Vec3, high: Vec3) => ({ low, high }),
      ProxyChild: (box: Box, offset: number, count: number, present: boolean, owned: boolean) => ({
        box,
        offset,
        count,
        present,
        owned,
      }),
    },
  )

const near = (actual: number, expected: number, span: number) =>
  Math.abs(actual - expected) <= 1e-5 * (Math.abs(span) + 1e-30)

test('proxyChild decodes the words of the compiler into a box that holds the child, in its parent', () => {
  eachGolden('proxy_child_box', 'proxy_child_box', (v, words, line) => {
    const low = v.slice(0, 3) as Vec3,
      high = v.slice(3, 6) as Vec3,
      childLow = v.slice(6, 9),
      childHigh = v.slice(9, 12)
    const child = readers(words).proxyChild(0, 0, { low, high })
    assert.equal(child.offset, v[13], line)
    assert.equal(child.count, v[12] & 255, line)
    assert.equal(child.present, true, line)
    // The writer ORs the count into word 1 above bit 16: it sets the owned bit only by a count
    // that reaches it.
    assert.equal(child.owned, (words[1] & PROXY_LEAF_OWNED) !== 0, line)
    assert.equal(child.owned, (((v[12] << 16) >>> 0) & PROXY_LEAF_OWNED) !== 0, line)
    const bytes = [words[0] & 255, (words[0] >> 8) & 255, (words[0] >> 16) & 255]
    const top = [(words[0] >>> 24) & 255, words[1] & 255, (words[1] >> 8) & 255]
    for (let axis = 0; axis < 3; axis++) {
      const span = high[axis] - low[axis]
      if (!(span > 0 && Number.isFinite(span))) {
        // A flat or non-comparable axis is the parent's full width.
        assert.deepEqual([bytes[axis], top[axis]], [0, 255], line)
        continue
      }
      // The reader's own arithmetic, from the bytes of the words.
      assert.ok(near(child.box.low[axis], low[axis] + (span / 255) * bytes[axis], span), line)
      assert.ok(near(child.box.high[axis], low[axis] + (span / 255) * top[axis], span), line)
      // What the compiler promises: the box is inside the parent and holds the child's part there.
      assert.ok(child.box.low[axis] >= low[axis] - 1e-5 * Math.abs(span), line)
      assert.ok(child.box.high[axis] <= high[axis] + 1e-5 * Math.abs(span), line)
      // A bound that is not a number is no promise: the compiler reads it as zero.
      if (Number.isFinite(childLow[axis] + childHigh[axis])) {
        const inside = (x: number) => Math.min(Math.max(x, low[axis]), high[axis])
        assert.ok(child.box.low[axis] <= inside(childLow[axis]) + 1e-5 * span, line)
        assert.ok(child.box.high[axis] >= inside(childHigh[axis]) - 1e-5 * span, line)
      }
    }
  })
})

// The golden words never set the owned bit (bit 25), so the assertions above cannot tell a reader
// that drops it: the shipped reader runs here on hand-built words, every combination of the
// present bit (24) and the owned bit (25) under a count byte (16..23) of 255.
test('proxyChild reads the present bit, the owned bit and the count byte independently', () => {
  const frame = { low: [0, 0, 0] as Vec3, high: [1, 1, 1] as Vec3 }
  for (const present of [false, true])
    for (const owned of [false, true])
      for (const count of [0, 255]) {
        const high =
          ((present ? 1 << 24 : 0) | (owned ? PROXY_LEAF_OWNED : 0) | (count << 16)) >>> 0
        const child = readers([0, high, 7]).proxyChild(0, 0, frame)
        const line = `present ${present}, owned ${owned}, count ${count}`
        assert.equal(child.count, count, line)
        assert.equal(child.owned, owned, line)
        assert.equal(child.offset, 7, line)
        // The shader reads presence as any bit above 23: the owned bit alone also reads present, as
        // a leaf the compiler writes owned is present.
        assert.equal(child.present, present || owned, line)
      }
})

test('proxyAlbedoOf decodes the word of the compiler into the bytes of the colour over 255', () => {
  eachGolden('albedo_pack', 'albedo_pack', (colour, [word], line) => {
    const albedo = readers([word]).proxyAlbedoOf(0)
    colour.forEach((channel, k) => {
      // A colour that is not a number is read as zero, as the compiler packs it.
      const byte = Number.isNaN(channel) ? 0 : Math.round(Math.min(Math.max(channel, 0), 1) * 255)
      assert.equal(albedo[k], byte / 255, line)
    })
    assert.equal(word >>> 24, 255, line)
  })
})
