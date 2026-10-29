// The compiled meshes that have a field mark their pages; an HLOD cell's field names a cell, not a
// mesh, and marks none. A section naming each mip's object reads the file whole, then each object
// when the mip is asked, checked against its digest.
import test from 'node:test'
import assert from 'node:assert/strict'
import type { MeshDistanceField } from '../../../../sdk-core/src/lighting/distanceFieldFile.ts'
import { createHash } from 'node:crypto'
import type { ClusterManifest } from '../../../../sdk-core/src/contracts/geometry.ts'
import {
  DISTANCE_FIELD_FILE,
  DISTANCE_FIELD_HEAD_BYTES,
  DISTANCE_FIELD_MAGIC,
  DISTANCE_FIELD_MESH_BYTES,
  DISTANCE_FIELD_MIPS,
  DISTANCE_FIELD_MIP_BYTES,
  DISTANCE_FIELD_VERSION,
} from '../../../../sdk-core/src/contracts/distanceFieldAbi.ts'
import { unmetered } from '../../geometry/cluster/byteMeter.ts'
import { distanceFieldMeshes, readDistanceFields } from './fieldsLoad.ts'

const field = (mesh: number, hlodCell: boolean) => ({ mesh, hlodCell }) as MeshDistanceField

test('the meshes that have a field leave out the HLOD cells that do', () => {
  assert.equal(distanceFieldMeshes(undefined), undefined)
  assert.equal(distanceFieldMeshes([]), undefined)
  const fields = [field(0, false), field(3, true), field(5, false), field(0, true)]
  assert.deepEqual([...distanceFieldMeshes(fields)!], [0, 5], 'cell 3 is no mesh 3')
  assert.equal(distanceFieldMeshes([field(1, true)]), undefined, 'a cache of cells alone')
})

/** A file of one record whose three mips, of one empty brick cell each, are objects of their own,
 *  and those objects: the file's head and record, then each mip's table. */
function objectsOf() {
  const file = new Uint8Array(DISTANCE_FIELD_HEAD_BYTES + DISTANCE_FIELD_MESH_BYTES)
  const view = new DataView(file.buffer)
  ;[DISTANCE_FIELD_MAGIC, DISTANCE_FIELD_VERSION, 1, 0].forEach((w, k) =>
    view.setUint32(k * 4, w, true),
  )
  ;[0, 0, 0, 1, 1, 1].forEach((v, i) =>
    view.setFloat32(DISTANCE_FIELD_HEAD_BYTES + 8 + i * 4, v, true),
  )
  for (let m = 0; m < DISTANCE_FIELD_MIPS; m++) {
    const mip = DISTANCE_FIELD_HEAD_BYTES + 32 + m * DISTANCE_FIELD_MIP_BYTES
    ;[1, 1, 1].forEach((side, i) => view.setUint32(mip + i * 4, side, true))
    view.setUint32(mip + 52, 4, true)
  }
  const mips = [0, 1, 2].map(() => new Uint8Array(Uint32Array.of(0xffffffff).buffer))
  return { file, mips }
}

const described = (bytes: Uint8Array, url: string) => ({
  url,
  bytes: bytes.byteLength,
  sha256: createHash('sha256').update(bytes).digest('hex'),
})

test("a section naming each mip's object reads the file, then each object once when a mip is asked", async () => {
  const { file, mips } = objectsOf()
  const served = new Map<string, Uint8Array>([[`https://cache/${DISTANCE_FIELD_FILE}`, file]])
  mips.forEach((mip, m) => served.set(`https://objects/${m}.bin`, mip))
  const asked: string[] = []
  const fetched = globalThis.fetch
  globalThis.fetch = (async (url: string) => {
    asked.push(String(url))
    return new Response(served.get(String(url))?.slice().buffer)
  }) as typeof fetch
  try {
    const section = (count: number) => ({
      version: DISTANCE_FIELD_VERSION,
      file: DISTANCE_FIELD_FILE,
      bytes: file.byteLength,
      // Mips 0 and 1 share one object, as identical mips do.
      mips: mips
        .slice(0, count)
        .map((mip, m) => described(mip, `https://objects/${m === 2 ? 2 : 0}.bin`)),
    })
    const metadata = (count: number) =>
      ({
        distanceFields: section(count),
        files: { [DISTANCE_FIELD_FILE]: described(file, DISTANCE_FIELD_FILE) },
      }) as unknown as ClusterManifest
    const never = () => assert.fail('no mip is read by a range')
    const fields = await readDistanceFields(
      metadata(3),
      'https://cache/',
      undefined,
      unmetered,
      never,
    )
    assert.deepEqual(asked, [`https://cache/${DISTANCE_FIELD_FILE}`], 'the file alone, no mip yet')
    const data = await fields![0].mips[2].read!()
    assert.deepEqual([...data.indirection], [0xffffffff])
    assert.deepEqual(asked.slice(1), ['https://objects/2.bin'])
    await Promise.all([fields![0].mips[0].read!(), fields![0].mips[1].read!()])
    assert.deepEqual(
      asked.slice(2),
      ['https://objects/0.bin'],
      'one read for the object two mips share',
    )
    // A section of version 3 names its objects, each {url, bytes, sha256}.
    for (const mips of [undefined, [{ url: 5 }], [{}]]) {
      const broken = { ...metadata(3), distanceFields: { ...section(3), mips } } as ClusterManifest
      await assert.rejects(
        readDistanceFields(broken, 'https://cache/', undefined, unmetered, never),
        {
          code: 'INVALID_CACHE',
          message: /names no object for its mips/,
        },
      )
    }
    await assert.rejects(
      readDistanceFields(metadata(2), 'https://cache/', undefined, unmetered, never),
      {
        code: 'INVALID_CACHE',
        message: /not an object for each mip/,
      },
    )
  } finally {
    globalThis.fetch = fetched
  }
})
