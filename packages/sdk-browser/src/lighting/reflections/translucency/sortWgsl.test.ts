// The sort of the traces by material (`sortWgsl.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { SORT_BINS, SORT_TRACES, SORT_TRACES_WGSL } from './sortWgsl.ts'

test('a workgroup sorts 4096 traces in 128 bins and its dispatch has one group for each 4096', () => {
  assert.equal(SORT_TRACES, 4096)
  assert.equal(SORT_BINS, 128)
  assert.match(SORT_TRACES_WGSL, /sortArgs\[0\]=\(sortTraces\.count\+4095u\)\/4096u;/)
})

test('the material id is the low fifteen bits, the bin its remainder, the offset the sum of the bins before', () => {
  assert.match(SORT_TRACES_WGSL, /\.r&0x7fffu/)
  assert.match(SORT_TRACES_WGSL, /%128u/)
  assert.match(SORT_TRACES_WGSL, /for\(var b=0u;b<lane;b\+\+\)\{sum\+=atomicLoad\(&bins\[b\]\);\}/)
  assert.match(SORT_TRACES_WGSL, /sortedTraces\[base\+offsets\[bin\[k\]\]\+rank\[k\]\]=held\[k\]/)
})
