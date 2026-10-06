// A stand-in for the SDK a street probe imports by URL (`harness/page.ts`, `street/streetPage.ts`): it counts the
// worlds opened, the models loaded and the worlds closed; its physics finds a wall two metres
// away along every heading, no ground above the floor and no roof — a model open to the sky.
export const opened = { worlds: 0, loads: 0, disposed: 0, physics: [] as boolean[] }

export function createWorld(_canvas: unknown, options: { physics?: boolean } = {}) {
  opened.worlds++
  opened.physics.push(options.physics === true)
  return {
    ready: Promise.resolve(),
    scene: {
      async load() {
        opened.loads++
        return {
          bounds: { min: { x: -10, y: 0, z: -10 }, max: { x: 10, y: 8, z: 10 } },
          record: { base: 'http://bench.test/model/' },
        }
      },
    },
    camera: { position: { set() {} } },
    physics: { error: null, stats: { bodies: 3 } },
    raycast: async (ray: { direction: { y: number } }) =>
      ray.direction.y === 0 ? { distance: 2 } : null,
    dispose: () => void opened.disposed++,
  }
}

export const math = {
  vector3: (x: number, y: number, z: number) => ({ x, y, z }),
  ray: (origin: unknown, direction: unknown) => ({ origin, direction }),
}

/** The page globals the two functions read, on Node's: a document, `fetch` that finds the
 *  model's `physics.json`, and a frame clock. */
export function pageGlobals() {
  const canvas = { style: { cssText: '' }, remove() {} }
  Object.assign(globalThis, {
    document: { createElement: () => canvas, body: { append() {} } },
    requestAnimationFrame: (done: () => void) => setImmediate(done),
    fetch: async () => ({ ok: true }),
  })
}
