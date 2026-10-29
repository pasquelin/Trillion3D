import assert from 'node:assert/strict'
import test from 'node:test'
import {
  BOX_VERTICES,
  MAX_QUERIES,
  OCCLUSION_BOX_ENTRY,
  OCCLUSION_BOX_WGSL,
  OCCLUSION_VERDICT_ENTRY,
  OCCLUSION_VERDICT_WGSL,
  QUERY_BATCH,
  SMALL_DEPTH_ENTRY,
  SMALL_DEPTH_FACTOR,
  SMALL_DEPTH_WGSL,
  smallDepthSize,
} from './hardwareOcclusionWgsl.ts'

test('the boxes and the verdicts are programs with their entries, the box program with no backtick', () => {
  assert.ok(OCCLUSION_BOX_WGSL.includes(`fn ${OCCLUSION_BOX_ENTRY}(`))
  assert.ok(OCCLUSION_VERDICT_WGSL.includes(`fn ${OCCLUSION_VERDICT_ENTRY}(`))
  assert.ok(!OCCLUSION_BOX_WGSL.includes('`'))
})

test('a box is twelve triangles, sixteen roots to a query, and the verdict kernel reads the same batch', () => {
  assert.equal(BOX_VERTICES, 36)
  assert.ok(OCCLUSION_BOX_WGSL.includes('array<u32,36>'))
  assert.ok(OCCLUSION_VERDICT_WGSL.includes(`QUERY_BATCH=${QUERY_BATCH}u`))
  assert.ok(OCCLUSION_VERDICT_WGSL.includes(`MAX_QUERIES=${MAX_QUERIES}u`))
})

test('the small depth pass keeps the farthest of the factor squared texels, no backtick', () => {
  assert.equal(SMALL_DEPTH_FACTOR, 2)
  assert.ok(SMALL_DEPTH_WGSL.includes(`fn ${SMALL_DEPTH_ENTRY}(`))
  assert.ok(SMALL_DEPTH_WGSL.includes(`FACTOR=${SMALL_DEPTH_FACTOR}u`))
  assert.ok(SMALL_DEPTH_WGSL.includes('min(min('))
  assert.ok(!SMALL_DEPTH_WGSL.includes('`'))
})

test('the small depth is each side of the image divided by the factor, rounded up', () => {
  assert.deepEqual(smallDepthSize([1920, 1081]), [960, 541])
})
