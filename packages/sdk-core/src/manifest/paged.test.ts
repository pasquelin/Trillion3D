import test from 'node:test';
import assert from 'node:assert/strict';
import { manifest, TEMPLATES } from '../../../../tests/fixtures/manifestBinary.ts';
import { EMPTY, pagedManifest } from '../../../../tests/fixtures/pagedManifest.ts';
import type { EngineError } from '../contracts/index.ts';
import { decodeManifestBinary } from './binaryDecode.ts';
import { encodeManifestBinary } from '../../../../tests/fixtures/manifestBinaryEncode.ts';
import { openPagedManifest, readPagedManifest } from './paged.ts';

/** The manifest one column file gave, before the manifest was paged. */
function whole() {
  const { manifest: slim, binary } = encodeManifestBinary(manifest(), TEMPLATES);
  return decodeManifestBinary(
    { ...slim, binary: { ...slim.binary, sha256: 'f' } },
    binary.buffer as ArrayBuffer,
  );
}

for (const [index, cut] of [false, true].flatMap((i) => [false, true].map((c) => [i, c])))
  test(`the paged manifest reads back what one column file gave${index ? ', through an index page' : ''}${cut ? ', one mesh page per primitive' : ''}`, async () => {
    const { root, files } = pagedManifest(manifest(), index, cut);
    const read = async ({ url }: { url: string }) => files.get(url)!;
    assert.deepEqual(await readPagedManifest(root, read), whole());
  });

test('a root that names no head page is refused', async () => {
  const { root, files } = pagedManifest(manifest());
  const refused = readPagedManifest({ ...root, head: EMPTY }, async ({ url }) => files.get(url)!);
  await assert.rejects(refused, (error: EngineError) => error.code === 'INVALID_CACHE');
});

test('an opened manifest holds the mesh pages it is asked for, each read once and dropped with its last holder', async () => {
  const { root, files } = pagedManifest(manifest(), false, true);
  const reads: string[] = [];
  const read = async ({ url }: { url: string }) => (reads.push(url), files.get(url)!);
  const { metadata, pages } = await openPagedManifest(root, read);
  const { primitives: all, ...head } = whole();
  assert.deepEqual({ ...metadata, primitives: [] }, { ...head, primitives: [] }, 'the head alone');
  assert.equal(metadata.primitives, pages.primitives);
  const [first, second] = root.pages as string[];
  const opened = reads.length;
  await Promise.all([pages.hold([first]), pages.hold([first, second])]);
  assert.equal(reads.length, opened + 4, 'each page and its sidecar read once');
  assert.deepEqual(metadata.primitives, all.slice(0, 2));
  pages.release([first, second]);
  assert.deepEqual(metadata.primitives, all.slice(0, 1), 'the first is still held');
  pages.release([first]);
  assert.deepEqual([metadata.primitives, pages.changes], [[], 4]);
  const landing = pages.hold([second]);
  pages.release([second]);
  await landing;
  assert.deepEqual(metadata.primitives, [], 'released before it landed, never listed');
});
