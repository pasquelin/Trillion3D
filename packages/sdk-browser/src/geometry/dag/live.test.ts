// The cut visits no cluster flat: level descent dispatches over the queue
// the previous level filled, `dagWanted` over candidate pages only, and the drawn list's kernel
// over the list of visible clusters. This file holds the list each kernel walks;
// `encode.test.ts` holds the number of commands a frame opens.
import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeDagKernels } from './encode.ts'
import { DAG_SELECTION_SHADER } from './shader/selectionShader.fixture.ts'
import { witnessEncoder, cutResources, VISIBLE, CAND, QUEUE } from './encode.fixture.ts'

test('each cut kernel dispatches over the list the previous one filled', () => {
  const witness = witnessEncoder()
  encodeDagKernels(witness.encoder, cutResources())
  const { dispatches } = witness.read()
  const byKernel = new Map(dispatches.map((l) => [l.kernel, l]))
  // Visible clusters: the verdict spoken on them alone.
  assert.equal(byKernel.get('dagDrawn')?.groups, 'indirect', 'dagDrawn follows a list')
  assert.equal(byKernel.get('dagDrawn')?.list, VISIBLE, 'dagDrawn follows the visible list')
  // Candidate pages, and them alone: a page under a rejected node is not read.
  assert.equal(byKernel.get('dagWanted')?.list, CAND)
  // Descent: pass 0 starts from the roots, from a count known at packing, and each later level
  // from the queue the level before it filled: no level visits the whole hierarchy, nor every
  // placement's.
  assert.deepEqual(dispatches.slice(1, 4), [
    { kernel: 'dagLevel0', groups: 1 },
    { kernel: 'dagLevel1', groups: 'indirect', list: QUEUE + 1 },
    { kernel: 'dagLevel2', groups: 'indirect', list: QUEUE + 2 },
  ])
  const ordre = dispatches.map((l) => l.kernel)
  assert.ok(ordre.indexOf('dagWanted') > ordre.lastIndexOf('dagLevel2'))
  assert.ok(ordre.indexOf('dagDrawn') > ordre.indexOf('dagWanted'))
  // The count launched flat is that of primitives, blocks, the roots' entries or one workgroup:
  // never that of clusters.
  const plats = dispatches.filter((l) => l.groups !== 'indirect').map((l) => l.kernel)
  assert.deepEqual(plats, ['dagPrepare', 'dagLevel0', 'dagFinish'])
})

test('wait between launches depends only on depth, not on cluster count', () => {
  const witness = witnessEncoder()
  encodeDagKernels(witness.encoder, cutResources())
  const { dispatches } = witness.read()
  // Prepare, one pass per level (three), the candidates' cull that writes the visible clusters, the
  // finish and the drawn list: the cut rule decides each cluster once, with no round per primitive
  // before it, and no mask, prefix or scatter stands between the cull and the list.
  assert.equal(dispatches.length, 7)
  const kernels = dispatches.map((l) => l.kernel)
  assert.ok(!kernels.includes('dagArgs') && !kernels.includes('dagDrawCount'))
  assert.equal(kernels[0], 'dagPrepare')
  // Prepare covers the primitives and the blended clusters' masks.
  assert.equal(dispatches[0].groups, 1)
  // Sixteen times more clusters, as many launches: depth is what counts them.
  const large = witnessEncoder()
  encodeDagKernels(large.encoder, cutResources(3, 65536))
  assert.equal(large.read().dispatches.length, dispatches.length)
  // One more level, one more launch.
  const profond = witnessEncoder()
  encodeDagKernels(profond.encoder, cutResources(4))
  assert.equal(profond.read().dispatches.length, dispatches.length + 1)
})

test('the drawn list’s kernel reads its cluster from the list of visible clusters, not from its thread id', () => {
  // The rejection — `visible` — is not in the kernel's body: a cluster missing from the list is
  // exactly a cluster whose `visible` was false.
  const corps = DAG_SELECTION_SHADER.split('fn dagDrawn(')[1].split('\n}')[0]
  assert.match(corps, /atomicLoad\(&visible\[/, 'dagDrawn reads the list')
  assert.doesNotMatch(corps, /visible\(/, 'dagDrawn does not redo the rejection')
})
