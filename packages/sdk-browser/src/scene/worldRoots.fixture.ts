// The fixture's world served over HTTP ranges, as a cache serves `world-roots.*`: what the world
// roots' tests and the cut's world root read (`worldRoots.test.ts`, `../webgpu/pages/prepare/`).
import type { TestContext } from 'node:test'
import { createHash } from 'node:crypto'
import type { ClusterManifest } from '../../../sdk-core/src/index.ts'
import { worldRootsFixture } from '../../../sdk-core/src/manifest/worldRoots.fixture.ts'
import { encodeWorldRootsDag } from '../../../sdk-core/src/manifest/worldRootsRecords.fixture.ts'

const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex')

/** The fixture's world served over HTTP ranges, `bin` its binary as the server holds it, `dag` the
 *  world DAG its cook writes beside it; returns the manifest that declares its files, the ranges
 *  asked and the files read whole. */
export function served(
  t: TestContext,
  bin?: Uint8Array,
  ignoresRange = false,
  dag?: Parameters<typeof encodeWorldRootsDag>[0],
) {
  const world = worldRootsFixture(sha)
  const records = { table: world.bytes, dag: dag && encodeWorldRootsDag(dag) }
  const held = bin ?? world.bin,
    ranges: string[] = [],
    whole: string[] = []
  t.mock.method(globalThis, 'fetch', async (input: string, init?: RequestInit) => {
    const file = /\.(table|dag)$/.exec(input)?.[1] as 'table' | 'dag' | undefined
    if (file) return (whole.push(file), new Response(records[file]!.slice()))
    const range = (init?.headers as Record<string, string>).Range
    ranges.push(range)
    if (ignoresRange) return new Response(held.slice())
    const [from, to] = range.slice('bytes='.length).split('-').map(Number)
    return new Response(held.slice(from, to + 1), { status: 206 })
  })
  const announce = (bytes: Uint8Array) => ({ bytes: bytes.byteLength, sha256: sha(bytes) })
  const files = {
    'world-roots.table': announce(records.table),
    ...(records.dag && { 'world-roots.dag': announce(records.dag) }),
  }
  return { ...world, ranges, whole, manifest: { files } as unknown as ClusterManifest }
}
