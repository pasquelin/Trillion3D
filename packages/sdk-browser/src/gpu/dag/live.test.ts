// The cut visits no cluster flat: level descent dispatches over the queue
// the previous level filled, `dagWanted` over candidate pages only, and the kernels
// that follow over the live-cluster list. This file holds the list each kernel walks;
// `encode.test.ts` holds the number of commands a frame opens.
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeDagKernels } from './encode.ts'
import { DAG_SELECTION_SHADER } from './shader/shader.ts'
import { witnessEncoder, cutResources, ETAGES, LIVE, CAND } from './encode.fixture.ts'
import { ceilDiv } from '../../../../math/src/scalar/integers.ts'

test('each cut kernel dispatches over the list the previous one filled', () => {
  const { encoder, dispatches } = witnessEncoder()
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, cutResources())
  const byKernel = new Map(dispatches.map((l) => [l.kernel, l]))
  // Live clusters: the previous verdict, spoken on them alone.
  for (const kernel of ['dagMask', 'dagDrawScatter']) {
    assert.equal(byKernel.get(kernel)?.groups, 'indirect', `${kernel} follows a list`)
    assert.equal(byKernel.get(kernel)?.list, LIVE, `${kernel} follows the live list`)
  }
  // Candidate pages, and them alone: a page under a rejected node is not read.
  assert.equal(byKernel.get('dagWanted')?.list, CAND)
  // Descent: pass 0 starts from the roots, from a count known at packing, and each
  // following level from its level's node count — known at packing too. No
  // indirection, hence no argument recopy, and no level visits the whole hierarchy.
  assert.deepEqual(dispatches.slice(2, 5), [
    { kernel: 'dagRootLevel', groups: 1 },
    { kernel: 'dagLevel1', groups: ceilDiv(ETAGES[1], 64) },
    { kernel: 'dagLevel2', groups: ceilDiv(ETAGES[2], 64) },
  ])
  const ordre = dispatches.map((l) => l.kernel)
  assert.ok(ordre.indexOf('dagWanted') > ordre.lastIndexOf('dagLevel2'))
  assert.ok(ordre.indexOf('dagMask') > ordre.indexOf('dagWanted'))
  // The count launched flat is that of primitives, blocks, a hierarchy level or one workgroup:
  // never that of clusters.
  const plats = dispatches.filter((l) => l.groups !== 'indirect').map((l) => l.kernel)
  assert.deepEqual(plats, [
    'dagPrepare',
    'dagRootLevel',
    'dagLevel1',
    'dagLevel2',
    'dagDrawPrefix',
    'dagSortRequests',
    'dagListEvictions',
  ])
})

test('wait between launches depends only on depth, not on cluster count', () => {
  const { encoder, dispatches } = witnessEncoder()
  encodeDagKernels(encoder as unknown as GPUCommandEncoder, cutResources())
  // Log clear, prepare, one pass per level (three), candidates, mask, prefix, compaction, the
  // request sort and the eviction queue: the cut rule decides each cluster once, in the mask, with
  // no round per primitive before it.
  assert.equal(dispatches.length, 11)
  const kernels = dispatches.map((l) => l.kernel)
  assert.ok(!kernels.includes('dagArgs') && !kernels.includes('dagDrawCount'))
  assert.equal(kernels[0], 'dagClearDrawn')
  assert.equal(kernels[1], 'dagPrepare')
  // Prepare covers both the primitives and the compaction blocks.
  assert.equal(dispatches[1].groups, 1)
  // Sixteen times more clusters, as many launches: depth is what counts them.
  const large = witnessEncoder()
  encodeDagKernels(large.encoder as unknown as GPUCommandEncoder, cutResources(3, 65536))
  assert.equal(large.dispatches.length, dispatches.length)
  // One more level, one more launch.
  const profond = witnessEncoder()
  encodeDagKernels(profond.encoder as unknown as GPUCommandEncoder, cutResources(4))
  assert.equal(profond.dispatches.length, dispatches.length + 1)
})

test('list kernels read their cluster from the list, not from their thread id', () => {
  // The rejection — `visible` — is not in these kernels' body: a cluster
  // missing from the list is exactly a cluster whose `visible` was false.
  for (const kernel of ['dagMask']) {
    const corps = DAG_SELECTION_SHADER.split(`fn ${kernel}(`)[1].split('\n}')[0]
    assert.match(corps, /=liveAt\(s\);/, `${kernel} reads the list`)
    assert.doesNotMatch(corps, /visible\(/, `${kernel} does not redo the rejection`)
  }
})
