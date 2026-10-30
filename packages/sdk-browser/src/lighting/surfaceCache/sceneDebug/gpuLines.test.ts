import assert from 'node:assert/strict'
import test from 'node:test'
import { wgslProgram } from '../../../../../math/src/wgsl/assemble.ts'
import { gpuLineColor, gpuLineSink } from './gpuLines.ts'

test('a colour is the bytes r, g, b, a of a word', () => {
  assert.equal(gpuLineColor(1, 1, 0), '4278255615u')
})

test('the sink appends with one atomic count and drops what is past the capacity', () => {
  const code = wgslProgram(
    '@compute @workgroup_size(1) fn main(){gpuLineRect(vec2f(0.0),vec2f(1.0),1u);}',
    [gpuLineSink(3, 4)],
  )
  assert.match(code, /@binding\(3\) var<storage,read_write> sinkLines:array<DebugLine>/)
  assert.match(code, /@binding\(4\) var<storage,read_write> sinkCount:atomic<u32>/)
  assert.match(code, /if\(at<arrayLength\(&sinkLines\)\)\{sinkLines\[at\]=line;\}/)
})

test('a filled quad is one pixel line as wide as the quad', () => {
  assert.match(
    gpuLineSink(0, 1).text,
    /fn gpuLineFilled\(lo:vec2f,hi:vec2f,color:u32\)\{\n let middle=0\.5\*\(lo\.y\+hi\.y\);/,
  )
})
