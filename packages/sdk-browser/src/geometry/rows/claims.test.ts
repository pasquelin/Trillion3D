import test from 'node:test'
import assert from 'node:assert/strict'
import { serveClaims } from './claims.ts'
import { createMarkedList } from '../../../../math/src/sequence/markedList.ts'

/** A row write of any duration, no clock reading it: the rows of what a frame installs are
 *  written all the same. */
const slowPlace = () => true

const owed = () => {
  const claims = createMarkedList()
  for (const page of [3, 1, 2, 0]) claims.add(page)
  return claims
}

test('the rows of the pages a frame installs are written whole, on no clock', () => {
  const claims = owed(),
    placed: number[] = []
  serveClaims(
    claims,
    () => true,
    (page) => (placed.push(page), slowPlace()),
  )
  assert.equal(claims.count, 0)
  assert.deepEqual(placed, [0, 1, 2, 3])
})

test('a page no rank is left for leaves the queue, named, and the pages after it are served', () => {
  const claims = owed(),
    refused: number[] = [],
    placed: number[] = []
  serveClaims(
    claims,
    () => true,
    (page) => page % 2 === 1 && placed.push(page) > 0,
    (page) => refused.push(page),
  )
  assert.equal(claims.count, 0, 'none waits: a full table is no time budget')
  assert.deepEqual(
    [refused, placed],
    [
      [0, 2],
      [1, 3],
    ],
  )
})
