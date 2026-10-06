/**
 * An image the cache baked is not read, wherever the document keeps it: on the committed fixture
 * `atlas-couleur` — one image by address beside it, one embedded in a view of its binary, one JPEG
 * by address — and the sidecar entries the compiler wrote for it (`expected.json`), the embedded
 * image's bytes are decoded only when its baked twin is missing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import type { ClusterManifest } from '../../../../sdk-core/src/index.ts'
import type { TableDocument } from '../../../../sdk-core/src/scene/core/tableDocuments.ts'
import { unmetered } from '../../cluster/byteMeter.ts'
import { bakedImages, PLACEHOLDER_IMAGE } from '../../texture/skip.ts'
import { decodingImages } from './decodedImages.fixture.ts'
import { preparedImages } from './images.ts'

const folder = new URL(
  '../../../../../tests/fixtures/formats/previews/atlas-couleur/',
  import.meta.url,
)
const json = async (name: string) => JSON.parse(await readFile(new URL(name, folder), 'utf8'))

type Gltf = {
  images: { uri?: string; bufferView?: number; mimeType?: string }[]
  bufferViews: { byteOffset: number; byteLength: number }[]
}

/** The fixture's images as the scene tables lay them out, its binary, and the compiler's entries. */
const fixture = (async () => {
  const gltf = (await json('atlas-couleur.gltf')) as Gltf
  const document = {
    images: gltf.images.map((image) => ({
      uri: image.uri ?? null,
      view: image.bufferView ?? null,
      mimeType: image.mimeType ?? null,
    })),
    views: gltf.bufferViews.map((view) => ({ offset: view.byteOffset, length: view.byteLength })),
  } as unknown as TableDocument
  const bin = await readFile(new URL('atlas-couleur.bin', folder))
  const binary = bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength)
  const { previews } = (await json('expected.json')) as { previews: { image: number }[] }
  return {
    document,
    binary,
    previews,
    embedded: gltf.images.findIndex((i) => i.bufferView !== undefined),
  }
})()

/** The byte length of each image decoded when `previews` are the sidecar's entries. */
async function decoded(t: test.TestContext, previews: { image: number }[]) {
  decodingImages(t)
  const { document, binary } = await fixture
  const metadata = { textures: { url: 'x' }, texturePreviews: previews } as ClusterManifest
  const read = preparedImages({
    document,
    documentUrl: folder.href,
    binary: async () => binary,
    signal: undefined,
    meter: unmetered,
    skipped: bakedImages(metadata, document.images.length),
    track: (_resource, image) => image,
  })
  const images = await Promise.all(document.images.map((_, rank) => read(rank)))
  return images.map((image) => (image as { bytes: number }).bytes)
}

const placeholder = (async () => (await (await fetch(PLACEHOLDER_IMAGE)).blob()).size)()

test('an embedded image with a baked twin decodes no byte of the binary (its fetch goes lazy in #876)', async (t) => {
  const { previews, document } = await fixture
  const size = await placeholder
  const sizes = await decoded(t, previews)
  assert.deepEqual(
    sizes,
    document.images.map(() => size),
    'every image is the placeholder',
  )
})

test('an embedded image with no baked twin still decodes its view of the binary', async (t) => {
  const { previews, document, embedded } = await fixture
  const size = await placeholder
  const sizes = await decoded(
    t,
    previews.filter((entry) => entry.image !== embedded),
  )
  const view = document.views[document.images[embedded].view!]
  const expected = document.images.map((_, rank) => (rank === embedded ? view.length : size))
  assert.deepEqual(sizes, expected, 'the embedded bytes are decoded, the others spared')
})
