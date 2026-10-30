// The key of a view's own states (`./viewKey.ts`): it is made once, follows the view through a switch, and differs from a view to another.
import test from 'node:test'
import assert from 'node:assert/strict'
import { tradeView } from '../../view/viewTrade.ts'
import { VIEW_GPU_KEYS } from './view.ts'
import { viewKey } from './viewKey.ts'

test('viewKey is made once and each view keeps its own through a switch', () => {
  const live: { viewKey?: object } = {}
  const main = viewKey(live)
  assert.equal(viewKey(live), main)
  const record: { viewKey?: object } = {}
  const other: { viewKey?: object } = {}
  tradeView(live as never, record as never, other as never, VIEW_GPU_KEYS)
  const aside = viewKey(live)
  assert.notEqual(aside, main)
  tradeView(live as never, other as never, record as never, VIEW_GPU_KEYS)
  assert.equal(viewKey(live), main)
  assert.equal(viewKey(other), aside)
})
