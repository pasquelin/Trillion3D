// The fixture's world served over HTTP ranges, as a cache serves `world-roots.*`: what the world
// roots' tests and the cut's world root read (`worldRoots.test.ts`, `../webgpu/pages/prepare/`).
import type { TestContext } from 'node:test'
import { createHash } from 'node:crypto'
import type { ClusterManifest } from '../../../sdk-core/src/index.ts'
import { worldRootsFixture } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import type { WorldRoots } from '../../../sdk-core/src/manifest/worldRoots.ts'
import { encodeWorldRootsDag } from '../../../sdk-core/src/manifest/worldRootsRecords.fixture.ts'
import { openWorldRoots, type WorldRootsHold } from './worldRoots.ts'
import { createPageStreamer } from '../streaming/pageStreamer.ts'
import { createPageCache } from '../streaming/pageCache.ts'
import type { PageStreamerOptions } from '../streaming/types.ts'

export const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** The world `manifest` declares, opened at `http://world/` as a world's model opens it before any
 *  session: through a queue of its own over `cache`, on the load's `signal`, let go once opened. */
export async function modelOpened(
  manifest: ClusterManifest,
  opening: { signal?: AbortSignal; whole?: boolean } = {},
  cache = createPageCache(),
) {
  const queue = createPageStreamer([], 'http://world/', { cache, signal: opening.signal })
  try {
    return await openWorldRoots(manifest, 'http://world/', queue, opening)
  } finally {
    queue.dispose()
  }
}

/** How `served` answers: the world it serves (the cook's fixture by default), its binary as the
 *  server holds it, whether the server ignores the Range, the world DAG its cook writes beside
 *  it, and `answer`, which may delay or refuse a range before `respond` answers it. */
type Serving = {
  world?: { bytes: Uint8Array; bin: Uint8Array; table: WorldRoots }
  bin?: Uint8Array
  ignoresRange?: boolean
  dag?: Parameters<typeof encodeWorldRootsDag>[0]
  answer?: (from: number, to: number, respond: () => Response) => Promise<Response>
}

/** A world served over HTTP ranges: the manifest that declares its files, the ranges asked and
 *  the files read whole. */
export function served(t: TestContext, serving: Serving = {}) {
  const world = serving.world ?? worldRootsFixture(sha),
    { dag, ignoresRange, answer = async (_from, _to, respond) => respond() } = serving
  const records = { table: world.bytes, dag: dag && encodeWorldRootsDag(dag) }
  const held = serving.bin ?? world.bin,
    ranges: string[] = [],
    whole: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    const file = /\.(table|dag)$/.exec(input)?.[1] as 'table' | 'dag' | undefined
    if (file) return (whole.push(file), new Response(records[file]!.slice()))
    const range = (init?.headers as Record<string, string>).Range
    ranges.push(range)
    if (ignoresRange) return new Response(held.slice())
    const [from, to] = range.slice('bytes='.length).split('-').map(Number)
    return answer(from, to, () => new Response(held.slice(from, to + 1), { status: 206 }))
  })
  const announce = (bytes: Uint8Array) => ({ bytes: bytes.byteLength, sha256: sha(bytes) })
  const files = {
    'world-roots.table': announce(records.table),
    ...(records.dag && { 'world-roots.dag': announce(records.dag) }),
  }
  return { ...world, ranges, whole, manifest: { files } as unknown as ClusterManifest }
}

/** The Range header that reads bundles `[first, end)` of `table`. */
export function rangeOf(table: WorldRoots, first: number, end: number) {
  const last = table.bundles[end - 1]
  return `bytes=${table.bundles[first].offset}-${last.offset + last.bytes - 1}`
}

/** How `opened` opens a world: the queue's transfers, its transfer budget and who hears a stall,
 *  and `whole` for a scene not partitioned. */
type Opening = Pick<PageStreamerOptions, 'onStalled' | 'maxTransferBytes'> & {
  transfers?: number
  whole?: boolean
}

/** The world `manifest` declares, opened at `http://world/` as a session's load opens it: through
 *  the session's queue, closed with the test. */
export async function opened(t: TestContext, manifest: ClusterManifest, opening: Opening = {}) {
  const { transfers, whole, onStalled, maxTransferBytes } = opening
  const options = { cache: createPageCache(), workerCount: transfers, onStalled, maxTransferBytes }
  const queue = createPageStreamer([], 'http://world/', options)
  t.after(() => queue.dispose())
  const roots = (await openWorldRoots(manifest, 'http://world/', queue, { whole }))!
  return { roots, queue }
}

/** The bundles `roots` holds now, ascending. */
export const heldBy = (roots: Pick<WorldRootsHold, 'table' | 'has'>) =>
  roots.table.bundles.map((_, bundle) => bundle).filter((bundle) => roots.has(bundle))
