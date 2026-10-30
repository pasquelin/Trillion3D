// The graph programs the any-hit test cuts by are held until every pass that casts rays has its kernels ready for the new set.

import test from 'node:test'
import assert from 'node:assert/strict'
import { createMaskHold, isReady } from './sceneMaskHold.ts'
import { NO_SCENE_MASKS, type SceneMaskPrograms } from './sceneMaskPrograms.ts'

const old = [{ key: 'old' }] as unknown as SceneMaskPrograms
const next = [{ key: 'next' }] as unknown as SceneMaskPrograms

const makers = new WeakMap<
  object,
  (programs: SceneMaskPrograms) => { ready: boolean; programs: SceneMaskPrograms }
>()

/** A pass whose kernels over `next` are ready once `done.next` is set: one maker for a `done`, as a pass has one maker (a maker that changes is a replaced device, which forgets the kernels of the old one). */
const pass = (done: { next: boolean }) => {
  const maker = (programs: SceneMaskPrograms) => ({
    get ready() {
      return programs !== next || done.next
    },
    programs,
  })
  return makers.get(done) ?? (makers.set(done, maker), maker)
}

test('the first set is held at once, and the same set is held again', () => {
  const hold = createMaskHold()
  assert.equal(hold.settle(old, 1), old)
  assert.equal(hold.settle(old, 2), old)
})

test('the held set stands until every pass that ran has its kernels ready for the new one, then all swap together', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const a = { next: true },
    b = { next: false }
  assert.equal(hold.use('a', '', pass(a), isReady)?.programs, old)
  assert.equal(hold.use('b', '', pass(b), isReady)?.programs, old)
  assert.equal(hold.settle(next, 2), old, 'b is not ready: the held set stands for both')
  hold.use('a', '', pass(a), isReady)
  hold.use('b', '', pass(b), isReady)
  assert.equal(hold.settle(next, 3), old)
  b.next = true
  hold.use('a', '', pass(a), isReady)
  hold.use('b', '', pass(b), isReady)
  assert.equal(hold.settle(next, 4), next, 'both ready: swapped')
  assert.equal(hold.use('a', '', pass(a), isReady)?.programs, next)
})

test('a pass that did not run since the last settling does not hold the swap back', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  hold.use('idle', '', pass({ next: false }), isReady)
  hold.settle(old, 2)
  assert.equal(hold.settle(next, 3), next)
})

test('settled again in the same image, the answer is the same', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  hold.use('b', '', pass({ next: false }), isReady)
  assert.equal(hold.settle(next, 2), old)
  assert.equal(
    hold.settle(next, 2),
    old,
    'a second ask in the image does not count the passes again',
  )
  assert.equal(hold.settle(NO_SCENE_MASKS, 2), old)
})

const newest = [{ key: 'newest' }] as unknown as SceneMaskPrograms

test('while graphs keep joining, the newest ready set among those wanted is swapped to', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const ready = new Set<SceneMaskPrograms>([old])
  const made: SceneMaskPrograms[] = []
  const make = (programs: SceneMaskPrograms) => {
    made.push(programs)
    return {
      get ready() {
        return ready.has(programs)
      },
      programs,
    }
  }
  hold.use('a', '', make, isReady)
  assert.equal(hold.settle(next, 2), old)
  ready.add(next)
  hold.use('a', '', make, isReady)
  assert.equal(hold.settle(newest, 3), next, 'the newest is not ready, the one before it is')
})

test('a pass that is not ready for the held set keeps running on the last set it had ready', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const done = { next: false }
  assert.equal(hold.use('rare', '', pass(done), isReady)?.programs, old)
  hold.use('often', '', pass({ next: true }), isReady)
  hold.settle(next, 2)
  assert.equal(hold.settle(next, 3), next)
  assert.equal(
    hold.use('rare', '', pass(done), isReady)?.programs,
    old,
    'its new kernel is compiling',
  )
  done.next = true
  assert.equal(hold.use('rare', '', pass(done), isReady)?.programs, next)
})

test('only the newest wanted set is made: an older candidate is looked up among the kernels already made, never started', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const made: SceneMaskPrograms[] = []
  const ready = new Set<SceneMaskPrograms>([old])
  const make = (programs: SceneMaskPrograms) => {
    made.push(programs)
    return {
      get ready() {
        return ready.has(programs)
      },
      programs,
    }
  }
  hold.use('a', '', make, isReady)
  hold.settle(next, 2)
  hold.use('a', '', make, isReady)
  made.length = 0
  // `newest` joins, `next` stays a candidate: only `newest` is made, `next` (made while it was the newest) is looked up.
  hold.settle(newest, 3)
  assert.deepEqual(made, [newest])
  ready.add(next)
  made.length = 0
  hold.use('a', '', make, isReady)
  assert.equal(hold.settle(newest, 4), next)
  assert.deepEqual(made.filter((set) => set === old || set === next).length, 1, 'held set only')
})

test('a pass that was not around when a candidate was the newest does not make it later', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  hold.use('first', '', pass({ next: false }), isReady)
  hold.settle(next, 2)
  const made: SceneMaskPrograms[] = []
  hold.use(
    'late',
    '',
    (programs) => {
      made.push(programs)
      return { ready: true, programs }
    },
    isReady,
  )
  hold.settle(newest, 3)
  assert.deepEqual(made, [old, newest], 'next was never made for the late pass')
})

test('a pass keyed by two kernel keys is two consumers: each falls back to its own last kernels', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const ready = new Set<string>(['plain|old'])
  const make = (key: string) => (programs: SceneMaskPrograms) => ({
    get ready() {
      return ready.has(`${key}|${programs === old ? 'old' : 'next'}`)
    },
    programs,
  })
  assert.equal(hold.use('p', 'plain', make('plain'), isReady)?.programs, old)
  hold.settle(next, 2)
  hold.settle(next, 3)
  ready.add('plain|next')
  hold.use('p', 'plain', make('plain'), isReady)
  assert.equal(hold.settle(next, 4), next)
  const other = hold.use('p', 'clouds', make('clouds'), isReady)
  assert.equal(other?.programs, next, 'no earlier kernels under this key: the held set, not ready')
  assert.equal(other?.kernel.ready, false)
  assert.equal(hold.use('p', 'plain', make('plain'), isReady)?.programs, next)
})

test('a pass whose kernels failed to compile is settled as failed: said once, it stays on its last set and does not hold the swap back', () => {
  let compiling = true
  const hold = createMaskHold()
  hold.settle(old, 1)
  const failing = pass({ next: false }),
    fine = pass({ next: true })
  hold.use('broken', '', failing, isReady, () => compiling)
  hold.use('fine', '', fine, isReady)
  const said: string[] = []
  assert.equal(
    hold.settle(next, 2, (name) => said.push(name)),
    old,
    'still compiling: waited for',
  )
  compiling = false
  hold.use('broken', '', failing, isReady, () => compiling)
  hold.use('fine', '', fine, isReady)
  assert.equal(
    hold.settle(next, 3, (name) => said.push(name)),
    next,
    'refused: not waited for',
  )
  assert.deepEqual(said, ['broken|'])
  assert.equal(
    hold.use('broken', '', failing, isReady, () => compiling)?.programs,
    old,
    'it stays on its last ready set',
  )
  assert.equal(hold.use('fine', '', fine, isReady)?.programs, next, 'the others swap')
})

test('only the pass own compile is waited for: other work compiling on the device does not hide a refusal', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const refused = pass({ next: false })
  hold.use('refused', '', refused, isReady, () => false)
  const said: string[] = []
  assert.equal(
    hold.settle(next, 2, (name) => said.push(name)),
    next,
    'its kernels are neither ready nor compiling: refused, not waited for',
  )
  assert.deepEqual(said, ['refused|'])
})

test('a pass evicted while its refused set is still wanted is not told again when it comes back', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const said: string[] = []
  const report = (name: string) => said.push(name)
  const refused = pass({ next: false })
  const slow = pass({ next: false })
  hold.use('p', '', refused, isReady, () => false)
  hold.use('slow', '', slow, isReady)
  hold.settle(next, 2, report)
  // Another pass keeps the swap waiting, so the set stays wanted while `p` is forgotten.
  for (let image = 3; image < 700; image++) {
    hold.use('slow', '', slow, isReady)
    hold.settle(next, image, report)
  }
  hold.use('p', '', refused, isReady, () => false)
  hold.settle(next, 700, report)
  assert.deepEqual(said, ['p|'], 'said once, the set being wanted all along')
})

test('a refusal is said once for the set, whatever the passes that come and go', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const said: string[] = []
  const report = (name: string) => said.push(name)
  const refused = pass({ next: false })
  hold.use('p', '', refused, isReady, () => false)
  hold.settle(next, 2, report)
  // The pass stays away long enough for the hold to forget it, then comes back for the same set.
  for (let image = 3; image < 700; image++) hold.settle(old, image)
  hold.use('p', '', refused, isReady, () => false)
  hold.settle(next, 700, report)
  assert.deepEqual(said, ['p|'], 'said once, not again for the pass that came back')
})

test('a refused pass whose kernels get ready later is swapped to as any other', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const done = { next: false }
  hold.use('p', '', pass(done), isReady, () => false)
  assert.equal(hold.settle(next, 2), next, 'refused: not held back')
  assert.equal(hold.use('p', '', pass(done), isReady, () => false)?.programs, old)
  done.next = true
  assert.equal(
    hold.use('p', '', pass(done), isReady, () => false)?.programs,
    next,
    'its retry landed',
  )
})

test('the passes of one group stay on the kernels they last had ready until every one is ready for the held set', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const a = { next: true },
    b = { next: false }
  const use = (name: string, done: { next: boolean }) =>
    hold.use(name, '', pass(done), isReady, undefined, 'together')
  use('a', a)
  use('b', b)
  assert.equal(hold.settle(next, 2), old, 'b is not ready: the swap waits')
  // b refuses (its compile is over) while a is ready: the swap is made, and the group does not split.
  hold.use('a', '', pass(a), isReady, undefined, 'together')
  hold.use('b', '', pass(b), isReady, () => false, 'together')
  assert.equal(hold.settle(next, 3), next, 'a refused pass does not hold the swap back')
  assert.equal(
    hold.use('a', '', pass(a), isReady, undefined, 'together')?.programs,
    old,
    'a peer refused for the held set keeps the whole group on the set every member had ready',
  )
  assert.equal(
    hold.use('b', '', pass(b), isReady, () => false, 'together')?.programs,
    old,
    'the refused pass stays on its last set',
  )
  b.next = true
  use('a', a)
  use('b', b)
  hold.settle(next, 4)
  assert.equal(
    use('b', b)?.programs,
    next,
    'its retry landed: the group is decided again at the next image',
  )
  assert.equal(use('a', a)?.programs, next)
  assert.equal(
    hold.use('alone', '', pass({ next: true }), isReady)?.programs,
    next,
    'a pass of no group is not held by it',
  )
})

test('a refusal over the new set is said only where the pass had its kernels ready over the set held', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const said: string[] = []
  const report = (name: string) => said.push(name)
  const never = () => ({ ready: false })
  hold.use('shared', '', never, isReady, () => false)
  hold.use('masked', '', pass({ next: false }), isReady, () => false)
  hold.settle(next, 2, report)
  assert.deepEqual(said, ['masked|'], 'a refusal over the set held as well is not the mask')
})

test('a group peer refused for the held set keeps the whole group on its common set, never two sets', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const a = { next: true },
    b = { next: false }
  const use = (name: string, done: { next: boolean }, pending: boolean) =>
    hold.use(name, '', pass(done), isReady, () => pending, 'together')
  use('a', a, false)
  use('b', b, true)
  assert.equal(hold.settle(next, 2), old, 'b compiles: waited for')
  use('a', a, false)
  use('b', b, false)
  assert.equal(hold.settle(next, 3), next, 'b is refused: not held back')
  assert.equal(use('a', a, false)?.programs, old, 'a stays with the refused b on the common set')
  assert.equal(use('b', b, false)?.programs, old)
})

test('a pass of a group with no kernels ready yet gets none while a peer runs an older set', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const a = { next: true }
  const use = (name: string, done: { next: boolean }) =>
    hold.use(name, '', pass(done), isReady, undefined, 'together')
  use('a', a)
  assert.equal(hold.settle(next, 2), next)
  a.next = false
  hold.settle(next, 3)
  // a had its kernels ready over the old set only; next, held now, is not ready for it (it was made after the swap).
  const late = (programs: SceneMaskPrograms) => ({ ready: true, programs })
  assert.equal(use('a', a)?.programs, old, 'a stays on its last ready set')
  assert.equal(
    hold.use('b', '', late, isReady, undefined, 'together'),
    undefined,
    'b has no kernels it can run on without splitting the group',
  )
  a.next = true
  hold.settle(next, 4)
  assert.equal(use('a', a)?.programs, next)
  assert.equal(hold.use('b', '', late, isReady, undefined, 'together')?.programs, next)
})

test('a refusal not said because the set before was not ready is said once that set is, if the refused one still is not', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const said: string[] = []
  const report = (name: string) => said.push(name)
  const ready = { old: false }
  const make = (programs: SceneMaskPrograms) => ({
    get ready() {
      return programs === old && ready.old
    },
    programs,
  })
  hold.use('p', '', make, isReady, () => false)
  hold.settle(next, 2, report)
  assert.deepEqual(said, [], 'the set before was not ready either')
  ready.old = true
  hold.use('p', '', make, isReady, () => false)
  hold.settle(next, 3, report)
  assert.deepEqual(said, ['p|'], 'said now')
  hold.settle(next, 4, report)
  assert.deepEqual(said, ['p|'], 'once')
})

test('a pass new to a group with nothing ready never vetoes the others: it does not run, they keep their set', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const a = { next: false }
  const use = (name: string) => hold.use(name, '', pass(a), isReady, undefined, 'together')
  assert.equal(use('a')?.programs, old)
  hold.settle(next, 2)
  const never = () => ({ ready: false })
  assert.equal(
    hold.use('b', '', never, isReady, undefined, 'together'),
    undefined,
    'b never had a set ready',
  )
  assert.equal(use('a')?.programs, old, 'a does not wait for b')
  hold.settle(next, 3)
  assert.equal(use('a')?.programs, old, 'b used: still no veto')
})

test('a group answers the whole image from the decision of its settling, whatever the order of its passes', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const a = { next: true },
    b = { next: true }
  const use = (name: string, done: { next: boolean }) =>
    hold.use(name, '', pass(done), isReady, undefined, 'together')
  use('a', a)
  use('b', b)
  assert.equal(hold.settle(next, 2), next)
  use('a', a)
  use('b', b)
  // b loses its kernels mid-image: the group was decided at the settling, and a is not told another set by the order of the calls.
  b.next = false
  assert.equal(use('a', a)?.programs, next)
  assert.equal(
    use('b', b),
    undefined,
    'b answers from the same decision: not ready on it, it does not run',
  )
  assert.equal(use('a', a)?.programs, next, 'the order of the calls changes nothing')
})

test('a refusal owed is said only when the refused kernels are not compiling, and not for a set no longer wanted', () => {
  const hold = createMaskHold()
  const third = [{ key: 'third' }] as unknown as SceneMaskPrograms
  hold.settle(old, 1)
  const said: string[] = []
  const report = (name: string) => said.push(name)
  const state = { old: false, pending: true }
  const make = (programs: SceneMaskPrograms) => ({
    get ready() {
      return programs === old && state.old
    },
    get pending() {
      return programs === next && state.pending
    },
  })
  const use = () => hold.use('p', '', make, isReady, (kernel) => kernel.pending)
  use()
  hold.settle(next, 2, report)
  state.old = true
  use()
  hold.settle(next, 3, report)
  assert.deepEqual(
    said,
    [],
    'the first set held before is ready, but the refused kernels still compile',
  )
  state.pending = false
  use()
  hold.settle(next, 4, report)
  assert.deepEqual(said, ['p|'], 'compile over, refused: said')
  // A refusal over a set that is dropped before the earlier kernels are ready is never said.
  const lost = createMaskHold()
  const closed: string[] = []
  lost.settle(old, 1)
  state.old = false
  const useLost = () => lost.use('q', '', make, isReady, () => false)
  useLost()
  lost.settle(next, 2, (name) => closed.push(name))
  useLost()
  lost.settle(third, 3, (name) => closed.push(name))
  state.old = true
  useLost()
  lost.settle(third, 4, (name) => closed.push(name))
  assert.deepEqual(
    closed,
    [],
    'the set dropped is not said, the held one waits for the kernels before it',
  )
})

test('the maker of a pass is released when the last pass naming it is forgotten, not before', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  let released = 0
  const make = Object.assign(pass({ next: true }), { release: () => released++ })
  hold.use('a', 'k', make, isReady)
  // b keeps running for a while after a is forgotten (a pass is forgotten after 600 settlings away).
  for (let frame = 2; frame < 400; frame++) {
    hold.use('b', 'k', make, isReady)
    hold.settle(old, frame)
  }
  for (let frame = 400; frame < 800; frame++) hold.settle(old, frame)
  assert.equal(released, 0, 'a is forgotten, b still names the maker')
  for (let frame = 800; frame < 1100; frame++) hold.settle(old, frame)
  assert.equal(released, 1, 'released once, with the last pass that names the maker')
})

test('a maker over a text key frees what it kept for the key when released', async () => {
  const { heldMakerOf, oncePerDeviceOverPrograms } = await import('./sceneMaskPrograms.ts')
  const device = {} as GPUDevice
  let built = 0,
    freed = 0
  const kernelOf = oncePerDeviceOverPrograms((_device: GPUDevice, key: string) => ({
    key,
    n: ++built,
  }))
  const maker = heldMakerOf(kernelOf, () => void freed++)
  const make = maker(device, 'k')
  assert.equal(make(old), make(old), 'one kernel for a set')
  assert.equal(maker(device, 'k'), make, 'one maker for a device and a key')
  make.release?.()
  assert.equal(freed, 1)
  assert.notEqual(maker(device, 'k'), make, 'the maker is made again')
  assert.equal(kernelOf(device, 'k', old).n, 2, 'and its kernel with it')
})

test('a maker shared by two holds frees its bookkeeping only when the last hold forgets it', async () => {
  const { heldMakerOf, oncePerDeviceOverPrograms } = await import('./sceneMaskPrograms.ts')
  const device = {} as GPUDevice
  let freed = 0
  const kernelOf = oncePerDeviceOverPrograms((_device: GPUDevice, key: string) => ({ key }))
  const make = heldMakerOf(kernelOf, () => void freed++)(device, 'k')
  const first = createMaskHold(),
    second = createMaskHold()
  for (const hold of [first, second]) {
    hold.settle(old, 1)
    hold.use('a', 'k', make, () => true)
  }
  // The first hold forgets its pass (600 settlings away); the second keeps using it.
  for (let frame = 2; frame < 700; frame++) {
    first.settle(old, frame)
    second.use('a', 'k', make, () => true)
    second.settle(old, frame)
  }
  assert.equal(freed, 0, 'the second hold still names the maker')
  for (let frame = 700; frame < 1400; frame++) second.settle(old, frame)
  assert.equal(freed, 1, 'freed once, with the last hold')
})

test('a group is decided from the passes that run: a member back after a pause gets nothing until its kernels are ready on the set the group runs on', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const rays = { next: true },
    lighting = { next: false }
  const use = (name: string, done: { next: boolean }) =>
    hold.use(name, '', pass(done), isReady, undefined, 'hits')
  use('rays', rays)
  use('lighting', lighting)
  hold.settle(old, 2)
  // The lighting pauses for an image; the swap is made without it, as for any pass that did not run.
  use('rays', rays)
  assert.equal(hold.settle(next, 3), next)
  // It comes back: its kernels are ready only on the old set, so it does not run; the group is not kept on the old set for it.
  assert.equal(use('lighting', lighting), undefined)
  assert.equal(
    use('rays', rays)?.programs,
    next,
    'one set for the group: the one the passes that ran have',
  )
  lighting.next = true
  use('rays', rays)
  use('lighting', lighting)
  hold.settle(next, 4)
  assert.equal(use('rays', rays)?.programs, next)
  assert.equal(use('lighting', lighting)?.programs, next)
})

test('a group member idle since a set was held does not keep the running members on it when the held set changes', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const both = { next: true },
    idle = { next: false }
  const use = (name: string, done: { next: boolean }) =>
    hold.use(name, '', pass(done), isReady, undefined, 'hits')
  use('running', both)
  use('idle', idle)
  hold.settle(old, 2)
  // From here on only one member runs; the other has `old` as its last ready set and never compiles `next`.
  use('running', both)
  hold.settle(old, 3)
  use('running', both)
  assert.equal(hold.settle(next, 4), next)
  assert.equal(use('running', both)?.programs, next)
})

test('a pass whose maker changes releases the old one and acquires the new one, once each while a pass names them', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const events: string[] = []
  const maker = (name: string) =>
    Object.assign(pass({ next: true }), {
      acquire: () => events.push(`+${name}`),
      release: () => events.push(`-${name}`),
    })
  const first = maker('first'),
    second = maker('second')
  hold.use('a', 'k', first, isReady)
  hold.use('b', 'k', first, isReady)
  assert.deepEqual(events, ['+first'])
  hold.use('a', 'k', second, isReady)
  assert.deepEqual(events, ['+first', '+second'], 'b still names the first maker')
  hold.use('b', 'k', second, isReady)
  assert.deepEqual(events, ['+first', '+second', '-first'])
  hold.use('b', 'k', second, isReady)
  assert.deepEqual(events, ['+first', '+second', '-first'], 'the same maker changes nothing')
})

test('a hold dropped releases the maker of every pass, once per maker', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const events: string[] = []
  const shared = Object.assign(pass({ next: true }), { release: () => events.push('shared') }),
    alone = Object.assign(pass({ next: true }), { release: () => events.push('alone') })
  hold.use('a', 'k', shared, isReady)
  hold.use('b', 'k', shared, isReady)
  hold.use('c', 'k', alone, isReady)
  hold.dispose()
  assert.deepEqual(events.sort(), ['alone', 'shared'])
  hold.dispose()
  assert.equal(events.length, 2, 'nothing is released twice')
})

test('a pass whose maker changes (a replaced device) forgets what the old maker made: no kernel of the old device is returned', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const device = (name: string, ready: boolean) => (programs: SceneMaskPrograms) => ({
    ready,
    programs,
    name,
  })
  const ready = (kernel: { ready: boolean }) => kernel.ready
  assert.equal(hold.use('a', 'k', device('first', true), ready)?.kernel.name, 'first')
  hold.settle(old, 2)
  const second = hold.use('a', 'k', device('second', false), ready)
  assert.equal(second?.kernel.name, 'second', 'the old device kernels are not the fallback')
  assert.equal(second?.programs, old)
})

test('a hold dropped serves no pass and acquires nothing', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  hold.dispose()
  const events: string[] = []
  const maker = Object.assign(pass({ next: true }), {
    acquire: () => events.push('+'),
    release: () => events.push('-'),
  })
  assert.equal(hold.use('a', 'k', maker, isReady), undefined)
  assert.equal(hold.use('a', 'k', maker, isReady, undefined, 'group'), undefined)
  assert.deepEqual(events, [], 'a maker named after the drop is never acquired, so never leaked')
})

test('a pass whose maker changes has its refusals forgotten: the refusal of the new maker is said again', () => {
  const hold = createMaskHold()
  hold.settle(old, 1)
  const said: string[] = []
  const report = (name: string) => said.push(name)
  // Another pass keeps compiling, so the set `next` stays a candidate while the refusals are told.
  const blocker = pass({ next: false })
  const refusedOver = (name: string, make: (programs: SceneMaskPrograms) => unknown) => {
    hold.use('blocker', '', blocker, isReady)
    hold.use(name, '', make as typeof blocker, isReady, () => false)
  }
  const ready = (programs: SceneMaskPrograms) => ({ ready: programs === old, programs })
  refusedOver('p', ready)
  hold.settle(next, 2, report)
  assert.deepEqual(said, ['p|'])
  // A replaced device: a new maker, with the same refusal over the same set.
  refusedOver('p', (programs) => ({ ready: programs === old, programs }))
  hold.settle(next, 3, report)
  assert.deepEqual(said, ['p|', 'p|'], 'said again for the new maker')
})
