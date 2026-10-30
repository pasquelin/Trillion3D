// The one resolver of the lit program (`litResolver`): the frame is held for exactly the program it will be lent, a toon program is lent only once its pipelines are compiled,
// and a toon program that can never light gives way to the plain one.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createLitVariants, litResolver } from './contractVariants.ts'

type Fake = { id: string; toonReady: boolean; toonRefused: boolean; askToon: () => void }

/** A table whose programs are `fake(...)`, compiled at once or failing. */
function table(id: string, state: Partial<Fake> | 'fails' = {}) {
  return createLitVariants<Fake>(
    async () => {
      if (state === 'fails') throw new Error('refused')
      return { id, toonReady: true, toonRefused: false, askToon() {}, ...state }
    },
    { twins: false },
  )
}

function resolverOf(toon: ReturnType<typeof table>, plain = table('plain')) {
  const sky = table('sky')
  return {
    plain,
    resolve: litResolver(plain, (skyShadowing, capsule, isToon) =>
      isToon ? toon : skyShadowing || capsule ? sky : plain,
    ),
    sky,
  }
}

test('a toon program is lent once its pipelines are compiled, the frame held until then', async () => {
  const state = { toonReady: false }
  const toon = createLitVariants<Fake>(
    async () => ({ id: 'toon', toonRefused: false, askToon() {}, ...state }) as Fake,
    {
      twins: false,
    },
  )
  const { resolve } = resolverOf(toon)
  const first = resolve(false, false, 0, undefined, false, false, true)
  assert.equal(first.program, undefined)
  assert.ok(first.pending, 'the compile is waited for')
  await toon.settle()
  const compiled = resolve(false, false, 0, undefined, false, false, true)
  assert.equal(compiled.program, undefined, 'compiled, its pipelines not')
  const program = await toon.ready(false, false, 0)
  program!.toonReady = true
  const ready = resolve(false, false, 0, undefined, false, false, true)
  assert.equal(ready.program?.id, 'toon')
  assert.equal(ready.pending, undefined)
})

test('a toon program whose pipelines the device refused for good gives way to the plain one', async () => {
  const toon = table('toon', { toonReady: false, toonRefused: true })
  const { resolve, plain } = resolverOf(toon)
  resolve(false, false, 0, undefined, false, false, true)
  await toon.settle()
  const falling = resolve(false, false, 0, undefined, false, false, true)
  assert.equal(falling.program, undefined)
  assert.ok(falling.pending, 'the plain program is asked, the frame waits for it')
  await plain.settle()
  const lit = resolve(false, false, 0, undefined, false, false, true)
  assert.equal(lit.program?.id, 'plain', 'lit plainly, not black')
  assert.equal(lit.pending, undefined)
})

test('a toon table whose compile failed everywhere gives way to the plain one', async () => {
  const toon = table('toon', 'fails')
  const { resolve, plain } = resolverOf(toon)
  resolve(false, false, 0, undefined, false, false, true)
  await toon.settle()
  resolve(false, false, 0, undefined, false, false, true)
  await plain.settle()
  assert.equal(resolve(false, false, 0, undefined, false, false, true).program?.id, 'plain')
})

test('pick and awaited read the same program: no plain program is lent while a toon one is waited for', async () => {
  const toon = table('toon', { toonReady: false })
  const { resolve, plain } = resolverOf(toon)
  await plain.ready(false, false, 0)
  const held = resolve(false, false, 0, undefined, false, false, true)
  assert.equal(held.program, undefined, 'the plain program is ready, the toon one is waited for')
  assert.ok(held.pending)
})

test('without toon, the sky or capsule table first, else the plain one, waited for while none is ready', async () => {
  const { resolve, plain, sky } = resolverOf(table('toon'))
  const none = resolve(false, false, 0, undefined, true)
  assert.equal(none.program, undefined)
  assert.ok(none.pending, 'the plain compile is waited for')
  await Promise.all([plain.settle(), sky.settle()])
  assert.equal(resolve(false, false, 0, undefined, true).program?.id, 'sky')
  assert.equal(
    resolve(true, false, 0, undefined, true).program?.id,
    'plain',
    'no sky occlusion with a bounce',
  )
  assert.equal(resolve(false, false, 0).program?.id, 'plain')
})

test('a toon pipeline refused to be tried again lends the plain program meanwhile, never an unlit frame', async () => {
  const state = { toonReady: false, toonRefused: true }
  const toon = createLitVariants<Fake>(
    async () => ({ id: 'toon', askToon() {}, ...state }) as Fake,
    { twins: false },
  )
  const { resolve, plain } = resolverOf(toon)
  resolve(false, false, 0, undefined, false, false, true)
  await toon.settle()
  resolve(false, false, 0, undefined, false, false, true)
  await plain.settle()
  const lent = resolve(false, false, 0, undefined, false, false, true)
  assert.equal(lent.program?.id, 'plain', 'the refusal is declared: lit plainly')
  assert.equal(lent.pending, undefined)
  state.toonReady = true
  state.toonRefused = false
  const program = await toon.ready(false, false, 0)
  Object.assign(program!, state)
  assert.equal(
    resolve(false, false, 0, undefined, false, false, true).program?.id,
    'toon',
    'the toon program takes over when it lands',
  )
})

test('the frame holds the pipelines of the toon program it would be lent, and a resolve that only warms holds none', async () => {
  const asked: string[] = []
  const toon = createLitVariants<Fake>(
    async () => ({
      id: 'toon',
      toonReady: false,
      toonRefused: false,
      askToon: () => asked.push('toon'),
    }),
    { twins: false },
  )
  const { plain } = resolverOf(toon)
  const resolved = litResolver(plain, (sky, capsule, isToon) => (isToon ? toon : plain))
  await toon.ready(false, false, 0)
  const held = resolved(false, false, 0, undefined, false, false, true)
  assert.equal(held.program, undefined)
  assert.equal(
    held.asking?.id,
    'toon',
    'the resolver names the program whose pipelines the frame waits for',
  )
  assert.deepEqual(asked, [], 'naming asks nothing: pick and awaited do')
})

test('a sky or capsule toon table not ready gives way to the plain toon table, as the non-toon branch does', async () => {
  const skyToon = createLitVariants<Fake>(
    async () => ({ id: 'sky-toon', toonReady: true, toonRefused: false, askToon() {} }),
    { twins: false },
  )
  const baseToon = table('base-toon')
  const plain = table('plain')
  const resolve = litResolver(plain, (sky, capsule, isToon) =>
    isToon ? (sky || capsule ? skyToon : baseToon) : plain,
  )
  const first = resolve(false, false, 0, undefined, true, false, true)
  assert.equal(first.program, undefined)
  assert.ok(first.pending, 'both toon tables compile, the frame waits')
  await Promise.all([skyToon.settle(), baseToon.settle()])
  assert.equal(resolve(false, false, 0, undefined, true, false, true).program?.id, 'sky-toon')
  const failed = createLitVariants<Fake>(async () => Promise.reject(new Error('refused')), {
    twins: false,
  })
  const fallback = litResolver(plain, (sky, capsule, isToon) =>
    isToon ? (sky || capsule ? failed : baseToon) : plain,
  )
  fallback(false, false, 0, undefined, true, false, true)
  await failed.settle()
  const lent = fallback(false, false, 0, undefined, true, false, true)
  assert.equal(
    lent.program?.id,
    'base-toon',
    'the sky toon table failed: the plain toon table lights',
  )
})

test('peek reads what resolve would lend, and asks nothing, compiles nothing and marks nothing asked', async () => {
  let built = 0
  const counting = (id: string) =>
    createLitVariants<Fake>(
      async () => (built++, { id, toonReady: true, toonRefused: false, askToon() {} }),
      { twins: false },
    )
  const plain = counting('plain'),
    toon = counting('toon')
  const resolve = litResolver(plain, (sky, capsule, isToon) => (isToon ? toon : plain))
  for (const asked of [false, true]) {
    const peeked = resolve.peek(false, false, 0, undefined, false, false, asked)
    assert.equal(peeked.program, undefined)
    assert.equal(peeked.pending, undefined, 'nothing is in flight to wait for')
  }
  await Promise.all([plain.settle(), toon.settle()])
  assert.equal(built, 0, 'no compile started')
  assert.equal(plain.slot(false, false, 0).asked, undefined, 'and none marked asked')
  // Resolved (asked), the program lands; peek then lends the very program resolve does.
  resolve(false, false, 0, undefined, false, false, true)
  await toon.settle()
  assert.equal(built, 1)
  assert.equal(resolve.peek(false, false, 0, undefined, false, false, true).program?.id, 'toon')
  assert.equal(resolve.peek(false, false, 0).program, undefined, 'the plain table is not asked yet')
  assert.equal(built, 1)
})

test('the toon pipelines of a program passed over redraw the view when they land, once, holding no frame', async () => {
  let land!: () => void
  const landing = new Promise<void>((resolve) => (land = resolve))
  let watches = 0
  const own = createLitVariants<Fake & { toonLanded: () => Promise<unknown> }>(
    async () => ({
      id: 'own',
      toonReady: false,
      toonRefused: false,
      askToon() {},
      toonLanded: () => (watches++, landing),
    }),
    { twins: false },
  )
  const base = table('base-toon')
  const plain = table('plain')
  let redraws = 0
  const resolve = litResolver(
    plain,
    (sky, capsule, isToon) => (isToon ? (sky || capsule ? own : base) : plain),
    () => redraws++,
  )
  await Promise.all([own.ready(false, false, 0), base.ready(false, false, 0)])
  for (let frame = 0; frame < 3; frame++) {
    const lent = resolve(false, false, 0, undefined, true, false, true)
    assert.equal(lent.program?.id, 'base-toon', 'the base toon program lights meanwhile')
    assert.equal(lent.asking, undefined, 'no frame waits')
  }
  assert.equal(watches, 1, 'watched once')
  assert.equal(redraws, 0)
  land()
  await landing
  await Promise.resolve()
  assert.equal(redraws, 1, 'the landing redraws the view')
})
