import assert from 'node:assert/strict'
import test from 'node:test'
import {
  commitOnSubmit,
  commitSubmitted,
  destroyAllRetired,
  destroyRetired,
  dropSubmitted,
  isMadeEncoder,
  isSettledEncoder,
  onSettled,
  openEncoder,
  retire,
  staleOpenEncoder,
  submitCommands,
} from './frameRetire.ts'
import { sessionHandle } from './sessionHandle.ts'

const encoder = () => ({}) as GPUCommandEncoder
/** An encoder made and open on `device`, as an image part is. */
const opened = (device: GPUDevice) => openEncoder(device, encoder)

test('a commit runs when the encoder it was asked for is submitted, once, in order', () => {
  const at = encoder()
  const ran: number[] = []
  commitOnSubmit(at, () => ran.push(1))
  commitOnSubmit(at, () => ran.push(2))
  commitSubmitted(at)
  commitSubmitted(at)
  assert.deepEqual(ran, [1, 2])
})

test('the commit of a dropped encoder never runs, nor does another encoder submit it', () => {
  const dropped = encoder()
  const other = encoder()
  const ran: string[] = []
  commitOnSubmit(dropped, () => ran.push('dropped'))
  commitOnSubmit(other, () => ran.push('other'))
  dropSubmitted(dropped)
  commitSubmitted(other)
  commitSubmitted(dropped)
  assert.deepEqual(ran, ['other'])
})

test('a throwing commit does not lose the others, and the encoder still settles', () => {
  const at = encoder()
  const ran: string[] = []
  commitOnSubmit(at, () => {
    throw new Error('first')
  })
  commitOnSubmit(at, () => ran.push('second'))
  onSettled(at, () => ran.push('settled'))
  assert.throws(() => commitSubmitted(at), /first/)
  assert.deepEqual(ran, ['second', 'settled'])
})

test('a settle that throws does not replace the commit’s error, and the first is thrown once both ran', () => {
  const at = encoder()
  const ran: string[] = []
  commitOnSubmit(at, () => {
    ran.push('commit')
    throw new Error('commit failed')
  })
  onSettled(at, () => {
    ran.push('settle')
    throw new Error('settle failed')
  })
  assert.throws(() => commitSubmitted(at), /commit failed/)
  assert.deepEqual(ran, ['commit', 'settle'])
  const alone = encoder()
  onSettled(alone, () => {
    throw new Error('settle failed')
  })
  assert.throws(() => commitSubmitted(alone), /settle failed/)
})

test('a release asked of an encoder already settled runs at once, and one asked during the settle too', () => {
  const at = encoder()
  const ran: string[] = []
  onSettled(at, () => onSettled(at, () => ran.push('nested')))
  dropSubmitted(at)
  assert.deepEqual(ran, ['nested'])
  onSettled(at, () => ran.push('late'))
  assert.deepEqual(ran, ['nested', 'late'])
})

const resource = () => {
  const made = { destroyed: false, destroy: () => void (made.destroyed = true) }
  return made
}

test('a retired resource outlives the encoders open at its retire, whoever else submits, and goes after they settle', () => {
  const device = {} as GPUDevice
  const open = opened(device)
  const other = opened(device)
  const held = resource()
  retire(device, held)
  // Another encoder is submitted: the open one may still bind the resource.
  destroyRetired(device, other)
  assert.equal(held.destroyed, false)
  commitSubmitted(open)
  destroyRetired(device)
  assert.equal(held.destroyed, true)
})

test('an encoder opened after the retire does not hold the resource, and the submitting encoder is settled for it', () => {
  const device = {} as GPUDevice
  const early = opened(device)
  const held = resource()
  retire(device, held)
  const late = opened(device)
  destroyRetired(device, early)
  assert.equal(held.destroyed, true)
  dropSubmitted(late)
})

test('submitCommands drops an encoder whose finish throws, and one the queue took nothing of', () => {
  const ran: string[] = []
  const at = { finish: () => ({}) } as unknown as GPUCommandEncoder
  commitOnSubmit(at, () => ran.push('commit'))
  onSettled(at, () => ran.push('settled'))
  const refused = { queue: { submit: () => {}, submits: 0 } } as unknown as GPUDevice
  assert.equal(submitCommands(refused, at), false)
  assert.deepEqual(ran, ['settled'])
  const throwing = {
    finish: () => {
      throw new Error('finish')
    },
  } as unknown as GPUCommandEncoder
  onSettled(throwing, () => ran.push('thrown settled'))
  assert.throws(() => submitCommands(refused, throwing), /finish/)
  assert.deepEqual(ran, ['settled', 'thrown settled'])
  const taken = {
    queue: {
      submits: 0,
      submit() {
        this.submits++
      },
    },
  } as unknown as GPUDevice
  assert.equal(submitCommands(taken, encoderWithFinish()), true)
})

function encoderWithFinish() {
  return { finish: () => ({}) } as unknown as GPUCommandEncoder
}

test('an encoder still being encoded across a few submits keeps holding what was retired', () => {
  const device = {} as GPUDevice
  const slow = opened(device)
  const held = resource()
  retire(device, held)
  for (let frame = 0; frame < 3; frame++) destroyRetired(device, encoder())
  assert.equal(held.destroyed, false)
  dropSubmitted(slow)
})

test('a session’s dispose frees what it retired and leaves the other sessions of the device their encoders and what waits for them', () => {
  const shared = {
    limits: {},
    features: {},
    lost: new Promise(() => {}),
    queue: {},
  } as unknown as GPUDevice
  const one = sessionHandle(shared, '@t3d:1').device
  const two = sessionHandle(shared, '@t3d:2').device
  const mine = opened(one)
  const ofOne = resource()
  retire(one, ofOne)
  const theirs = opened(two)
  const ofTwo = resource()
  retire(two, ofTwo)
  const ofOneAfter = resource()
  retire(one, ofOneAfter)
  destroyAllRetired(one)
  assert.equal(ofOne.destroyed, true)
  // The other session's encoder is open: what was retired after it waits, whoever retired it, and so does its own resource.
  assert.equal(ofOneAfter.destroyed, false)
  assert.equal(ofTwo.destroyed, false)
  destroyRetired(two)
  assert.equal(ofTwo.destroyed, false)
  commitSubmitted(theirs)
  destroyRetired(two)
  assert.equal(ofTwo.destroyed, true)
  assert.equal(ofOneAfter.destroyed, true)
  assert.equal(isMadeEncoder(mine), true)
})

test('an encoder open holds a resource retired after it until it settles; one settled holds nothing for good', () => {
  const device = {} as GPUDevice
  const at = opened(device)
  assert.equal(isMadeEncoder(at), true)
  assert.equal(isMadeEncoder(encoder()), false)
  const held = resource()
  retire(device, held)
  dropSubmitted(at)
  destroyRetired(device)
  assert.equal(held.destroyed, true)
  const later = resource()
  retire(device, later)
  destroyRetired(device)
  assert.equal(later.destroyed, true)
})

test('an encoder already settled is refused by submitCommands, told, and finishes nothing', () => {
  let finished = 0
  const at = {
    finish: () => (finished++, {}),
  } as unknown as GPUCommandEncoder
  const device = { queue: { submit: () => {} } } as unknown as GPUDevice
  dropSubmitted(at)
  let told = 0
  assert.equal(
    submitCommands(device, at, () => told++),
    false,
  )
  assert.equal(told, 1)
  assert.equal(finished, 0)
})

test('destroyRetired with nothing retired does nothing, and compacts the list in place', () => {
  const device = {} as GPUDevice
  destroyRetired(device)
  const open = opened(device)
  const before = resource()
  retire(device, before)
  const after = resource()
  retire(device, after)
  destroyRetired(device)
  assert.deepEqual([before.destroyed, after.destroyed], [false, false])
  dropSubmitted(open)
  destroyRetired(device)
  assert.deepEqual([before.destroyed, after.destroyed], [true, true])
})

test('a resource waits for the encoders open at its retire only, whatever the order they settle in', () => {
  const device = {} as GPUDevice
  const older = opened(device)
  const newer = opened(device)
  const held = resource()
  retire(device, held)
  const after = opened(device)
  // The newer one settles first: the older still holds the resource.
  dropSubmitted(newer)
  destroyRetired(device)
  assert.equal(held.destroyed, false)
  dropSubmitted(older)
  destroyRetired(device)
  assert.equal(held.destroyed, true)
  dropSubmitted(after)
})

test('a session’s dispose settles its open encoders: their releases run, their commits never do', () => {
  const device = {} as GPUDevice
  const open = opened(device)
  const ran: string[] = []
  onSettled(open, () => ran.push('release'))
  commitOnSubmit(open, () => ran.push('commit'))
  destroyAllRetired(device)
  assert.deepEqual(ran, ['release'])
})

test('an encoder left open across many submits is reported stale once, never destroyed; a settled one is not', () => {
  const device = {} as GPUDevice
  const leaked = opened(device)
  assert.equal(staleOpenEncoder(device), false)
  for (let submit = 0; submit < 241; submit++) {
    const sent = opened(device)
    commitSubmitted(sent)
    destroyRetired(device, sent)
  }
  assert.equal(staleOpenEncoder(device), true)
  assert.equal(staleOpenEncoder(device), false)
  assert.equal(isSettledEncoder(leaked), false)
  dropSubmitted(leaked)
  assert.equal(staleOpenEncoder(device), false)
})

test('every encoder left open past the threshold is reported, the oldest first, each once', () => {
  const device = {} as GPUDevice
  const first = opened(device)
  const second = opened(device)
  for (let submit = 0; submit < 241; submit++) {
    const sent = opened(device)
    commitSubmitted(sent)
    destroyRetired(device, sent)
  }
  assert.equal(staleOpenEncoder(device), true)
  assert.equal(staleOpenEncoder(device), true)
  assert.equal(staleOpenEncoder(device), false)
  dropSubmitted(first)
  dropSubmitted(second)
})

test('the encoder just submitted is never reported stale, though no resource waits on the retire list', () => {
  const device = {} as GPUDevice
  const sent = opened(device)
  for (let submit = 0; submit < 241; submit++) {
    const other = opened(device)
    destroyRetired(device, other)
  }
  // Nothing was retired: the early return of the walk must still have taken the encoder out of the open set.
  destroyRetired(device, sent)
  assert.equal(staleOpenEncoder(device), false)
})
