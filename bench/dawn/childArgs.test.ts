import assert from 'node:assert/strict'
import { test } from 'node:test'
import { childArgs } from './childArgs.ts'

test('a child keeps the run’s own options and drops what the parent decides', () => {
  assert.deepEqual(
    childArgs([
      'a-page',
      '--scenario',
      'world',
      '--dissect',
      'vsm.projection',
      '--profile',
      'mobile',
      '--features-off',
      'subgroups',
      '--dirty',
      '--engine',
      'x',
      '--switch',
      'a=1',
      '--scale=page',
      '--repeat',
      '3',
    ]),
    [
      '--profile',
      'mobile',
      '--features-off',
      'subgroups',
      '--dirty',
      '--switch',
      'a=1',
      '--scale=page',
    ],
  )
})

test('an A/B’s two checkouts are no options of a child', () => {
  assert.deepEqual(childArgs(['page', '--ab', 'A', 'B', '--rounds', '4', '--warm', '40']), [
    '--warm',
    '40',
  ])
})

test('the flag that takes no image is carried without eating the next token', () => {
  assert.deepEqual(childArgs(['page', '--no-capture', '--warm', '40']), [
    '--no-capture',
    '--warm',
    '40',
  ])
})
