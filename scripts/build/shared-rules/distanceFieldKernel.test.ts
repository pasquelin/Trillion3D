import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DISTANCE_FIELD_KERNEL_BATCH,
  DISTANCE_FIELD_KERNEL_WGSL,
  DISTANCE_FIELD_KERNEL_WORKGROUP,
} from '../../../packages/sdk-core/src/lighting/distanceFieldKernel.ts'
import { rustSource } from './rust.ts'
import { distanceFieldKernelTs } from './distanceFieldKernel.ts'

const CRATE = 'packages/asset-compiler-rust/src'

test("the browser runs the text the compiler runs: the crate's own WGSL files, in the order it assembles them", () => {
  const files = [
    `${CRATE}/hlod/flatten/gpu/scene_words.wgsl`,
    `${CRATE}/hlod/flatten/approximate/gpu/tree.wgsl`,
    `${CRATE}/distance_field/gpu/field.wgsl`,
  ].map(rustSource)
  const at = files.map((file) => DISTANCE_FIELD_KERNEL_WGSL.indexOf(file))
  assert.ok(
    at.every((position) => position >= 0),
    'each file is in the program whole',
  )
  assert.deepEqual(
    at,
    [...at].sort((a, b) => a - b),
  )
  assert.equal(DISTANCE_FIELD_KERNEL_WGSL.endsWith(files[2]), true)
  // The compiler's source lists the files in this order (`source` of `distance_field/gpu.rs`).
  const gpu = rustSource(`${CRATE}/distance_field/gpu.rs`)
  const listed = [...gpu.matchAll(/include_str!\("([^"]+)"\)/g)].map((m) => m[1].split('/').pop())
  assert.deepEqual(listed, ['scene_words.wgsl', 'tree.wgsl', 'field.wgsl'])
})

test("the prelude holds the constants the compiler's prelude holds, and no other", () => {
  const declared = (text: string) =>
    [...text.matchAll(/^const (\w+): (?:u32|f32) = /gm)].map((m) => m[1])
  const prelude = DISTANCE_FIELD_KERNEL_WGSL.slice(
    0,
    DISTANCE_FIELD_KERNEL_WGSL.indexOf('// The scene buffer'),
  )
  const layout = rustSource(`${CRATE}/distance_field/gpu/layout.rs`)
  const rust = layout.slice(layout.indexOf('pub(super) fn prelude'))
  const named = [...rust.matchAll(/\("(\w+)", /g)].map((m) => m[1])
  assert.deepEqual(declared(prelude), [...named, 'PULLBACK'])
})

test("the numbers the host packs by are the compiler's", () => {
  assert.equal(DISTANCE_FIELD_KERNEL_WORKGROUP, 64)
  assert.equal(DISTANCE_FIELD_KERNEL_BATCH, 1 << 20)
  assert.match(DISTANCE_FIELD_KERNEL_WGSL, /const STACK: u32 = 73u;/)
  assert.match(DISTANCE_FIELD_KERNEL_WGSL, /const ECHO_MASK: u32 = 8388607u;/)
  assert.match(DISTANCE_FIELD_KERNEL_WGSL, /const DOUBTFUL: u32 = 2147483648u;/)
})

test('the printed module is what the printer prints today', () => {
  const text = distanceFieldKernelTs()
  assert.ok(text.includes(DISTANCE_FIELD_KERNEL_WGSL.replaceAll('`', '\\`')))
})
