import test from 'node:test'
import assert from 'node:assert/strict'
import { resolveObjectURL } from 'node:buffer'
import { startModuleWorker } from './besideModule.ts'

/** The workers started, each with the URL and options it was given. */
function stubbedWorkers(origin: string | undefined) {
  const started: { url: string; options: WorkerOptions }[] = []
  const scope = globalThis as unknown as Record<string, unknown>
  scope.location = origin ? { origin } : undefined
  scope.Worker = class {
    constructor(url: string, options: WorkerOptions) {
      started.push({ url: String(url), options })
    }
  }
  return started
}

test("a worker of the page's own origin starts on its module", () => {
  const started = stubbedWorkers('https://site.test')
  startModuleWorker(new URL('https://site.test/dist/pageWorker.js'))
  assert.deepEqual(started, [
    { url: 'https://site.test/dist/pageWorker.js', options: { type: 'module' } },
  ])
})

test('a worker served from a CDN starts on a same-origin module that imports it', async () => {
  const started = stubbedWorkers('https://site.test')
  const cdn = 'https://cdn.test/npm/trillion3d/dist/physicsWorker.js'
  startModuleWorker(cdn)
  startModuleWorker(cdn)
  assert.equal(started.length, 2)
  // One stand-in per module, reused: a worker's threads start on its location, the same blob.
  assert.equal(started[0].url, started[1].url)
  assert.match(started[0].url, /^blob:/)
  assert.deepEqual(started[0].options, { type: 'module' })
  const source = await resolveObjectURL(started[0].url)?.text()
  assert.equal(source, `import ${JSON.stringify(cdn)};`)
})

test('without a page (Node) the worker starts on the very URL given, as a DOM Worker shim reads it', () => {
  const given: unknown[] = []
  const scope = globalThis as unknown as Record<string, unknown>
  scope.location = undefined
  scope.Worker = class {
    constructor(url: unknown) {
      given.push(url)
    }
  }
  const module = new URL('file:///engine/dist/pageWorker.js')
  startModuleWorker(module)
  assert.equal(given[0], module)
})
