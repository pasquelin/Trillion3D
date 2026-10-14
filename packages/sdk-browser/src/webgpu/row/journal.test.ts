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

test('the residency changes read increasing, each page once, those named after a read joined', () => {
  const journal = createWebgpuRowJournal()
  for (const page of [9, 2, 9, 5]) journal.noteResidencyChange(page)
  assert.deepEqual(
    [...journal.residencyChanges.pages],
    [2, 5, 9],
    'sorted at the read, no sort asked',
  )
  journal.noteResidencyChange(3)
  journal.noteResidencyChange(5)
  assert.equal(journal.residencyChanges.count, 4)
  assert.deepEqual([...journal.residencyChanges.pages], [2, 3, 5, 9], 'a later name joins in order')
  journal.clearResidencyChanges()
  assert.equal(journal.residencyChanges.count, 0)
  journal.noteResidencyChange(1)
  assert.deepEqual([...journal.residencyChanges.pages], [1], 'a clear forgets what was read')
})
