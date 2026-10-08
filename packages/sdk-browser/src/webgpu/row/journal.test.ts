// The row journal names every page whose coverage flips to its one watcher, the cut publication
// (`../cut/publication.ts`): a second watcher would silently replace the first, so it is refused.
// Every name advances `touchRevision`, which the residency queue compares (`../residency/queue.ts`).
import test from 'node:test'
import assert from 'node:assert/strict'
import { createWebgpuRowJournal } from './journal.ts'

test('the journal has one watcher, told every page named, and counts the names', () => {
  const journal = createWebgpuRowJournal()
  const heard: number[] = []
  journal.watchTouched((page) => heard.push(page))
  assert.throws(() => journal.watchTouched(() => {}), /ROW_JOURNAL_WATCHED_TWICE/)
  const before = journal.touchRevision()
  journal.touchPage(3)
  journal.touchPage(3)
  assert.deepEqual(heard, [3, 3], 'each name, duplicates included')
  assert.equal(journal.touchRevision(), before + 2)
  assert.equal(journal.touched.count, 1)
})
