import { EngineError } from './contracts.ts';
import {
  BYTES_PER_ELEMENT,
  COLUMN_KIND,
  COLUMN_NAMES,
  COLUMN_STRIDE,
  MANIFEST_BINARY_HEADER_WORDS,
  MANIFEST_BINARY_MAGIC,
  MANIFEST_BINARY_VERSION,
  type ColumnName,
} from './manifestBinaryFormat.ts';
import { columnElements, type Counts } from './manifestBinaryLayout.ts';
import { assertManifestBinary, type SlimClusterManifest } from './manifestBinaryTypes.ts';

export function readManifestColumns(slim: SlimClusterManifest, buffer: ArrayBuffer) {
  assertManifestBinary(slim.binary);
  if (buffer.byteLength < (MANIFEST_BINARY_HEADER_WORDS + COLUMN_NAMES.length * 2) * 4)
    throw new EngineError('INVALID_CACHE', 'Manifest binary is shorter than its header', {
      bytes: buffer.byteLength,
    });
  const header = new Uint32Array(buffer, 0, MANIFEST_BINARY_HEADER_WORDS + COLUMN_NAMES.length * 2);
  if (header[0] !== MANIFEST_BINARY_MAGIC)
    throw new EngineError('INVALID_CACHE', 'Manifest binary has no WGMB signature', {
      magic: header[0],
    });
  if (header[1] !== MANIFEST_BINARY_VERSION)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      `Expected manifest binary version ${MANIFEST_BINARY_VERSION}, received ${header[1]}`,
      { version: header[1] },
    );
  if (header[2] !== COLUMN_NAMES.length)
    throw new EngineError(
      'UNSUPPORTED_FORMAT',
      'Manifest binary column count differs from this version',
      { columns: header[2], expected: COLUMN_NAMES.length },
    );
  const counts: Counts = {
    pages: 0,
    cullingNodes: 0,
    groups: 0,
    children: 0,
    outputs: 0,
    roots: 0,
    bundles: 0,
    previews: slim.binary.texturePreviews,
    previewBytes: slim.binary.texturePreviewBytes,
  };
  for (const primitive of slim.primitives) {
    const binary = primitive.binary;
    if (!binary || !Number.isSafeInteger(binary.pages) || binary.pages < 0)
      throw new EngineError('INVALID_CACHE', 'A primitive has no binary page count', {
        mesh: primitive.mesh,
        primitive: primitive.primitive,
      });
    counts.pages += binary.pages;
    counts.cullingNodes += binary.culling?.count ?? 0;
    counts.groups += binary.structure?.groups ?? 0;
    counts.roots += binary.structure?.roots ?? 0;
    counts.bundles += binary.streams?.pages ?? 0;
  }
  const at = (index: number) => ({
    offset: header[MANIFEST_BINARY_HEADER_WORDS + index * 2],
    length: header[MANIFEST_BINARY_HEADER_WORDS + index * 2 + 1],
  });
  const column = <T>(name: ColumnName, make: (b: ArrayBuffer, o: number, n: number) => T): T => {
    const index = COLUMN_NAMES.indexOf(name),
      { offset, length } = at(index);
    const element = BYTES_PER_ELEMENT[COLUMN_KIND[name]];
    if (offset % 8 !== 0 || length % element !== 0 || offset + length > buffer.byteLength)
      throw new EngineError('INVALID_CACHE', `Manifest binary column ${name} is out of bounds`, {
        column: name,
        offset,
        length,
        bytes: buffer.byteLength,
      });
    return make(buffer, offset, length / element);
  };
  const expect = (name: ColumnName, elements: number) => {
    const { length } = at(COLUMN_NAMES.indexOf(name));
    const wanted = elements * COLUMN_STRIDE[name] * BYTES_PER_ELEMENT[COLUMN_KIND[name]];
    if (length !== wanted)
      throw new EngineError(
        'INVALID_CACHE',
        `Manifest binary column ${name} does not match the declared counts`,
        { column: name, length, expected: wanted },
      );
  };
  // The flat child and output arrays are as long as the per-group counts say; everything else is
  // fixed by the counts the small JSON declares, so every column is checked before a byte is read.
  expect('groupChildCount', counts.groups);
  expect('groupOutputCount', counts.groups);
  const groupChildCount = column('groupChildCount', (b, o, n) => new Int32Array(b, o, n)),
    groupOutputCount = column('groupOutputCount', (b, o, n) => new Int32Array(b, o, n));
  for (let g = 0; g < counts.groups; g++) {
    if (groupChildCount[g] < 0 || groupOutputCount[g] < 0)
      throw new EngineError('INVALID_CACHE', 'A group declares a negative member count', {
        group: g,
      });
    counts.children += groupChildCount[g];
    counts.outputs += groupOutputCount[g];
  }
  for (const name of COLUMN_NAMES) expect(name, columnElements(name, counts));
  const bounds = column('pageBounds', (b, o, n) => new Float64Array(b, o, n)),
    sphere = column('pageSphere', (b, o, n) => new Float64Array(b, o, n));
  const parentSphere = column('pageParentSphere', (b, o, n) => new Float64Array(b, o, n)),
    error = column('pageError', (b, o, n) => new Float64Array(b, o, n));
  const ints = column('pageInt', (b, o, n) => new Int32Array(b, o, n)),
    words = column('pageU32', (b, o, n) => new Uint32Array(b, o, n));
  const geometryWords = column('geometryU32', (b, o, n) => new Uint32Array(b, o, n));
  const cullingNodes = column('cullingNodes', (b, o, n) => new Float64Array(b, o, n));
  const groupLevel = column('groupLevel', (b, o, n) => new Int32Array(b, o, n)),
    groupError = column('groupError', (b, o, n) => new Float64Array(b, o, n));
  const groupSphere = column('groupSphere', (b, o, n) => new Float64Array(b, o, n));
  const groupChild = column('groupChild', (b, o, n) => new Int32Array(b, o, n));
  const groupOutput = column('groupOutput', (b, o, n) => new Int32Array(b, o, n));
  const structureRoot = column('structureRoot', (b, o, n) => new Int32Array(b, o, n));
  const bundleWords = column('bundleU32', (b, o, n) => new Uint32Array(b, o, n));
  const pageDepthLayer = column('pageDepthLayer', (b, o, n) => new Uint32Array(b, o, n));
  const decoder = new TextDecoder('latin1');
  const pageShaText = decoder.decode(column('pageSha', (b, o, n) => new Uint8Array(b, o, n)));
  const geometryShaText = decoder.decode(
    column('geometrySha', (b, o, n) => new Uint8Array(b, o, n)),
  );
  const bundleShaText = decoder.decode(column('bundleSha', (b, o, n) => new Uint8Array(b, o, n)));
  const previewWords = column('texturePreviewU32', (b, o, n) => new Uint32Array(b, o, n));
  const previewShaText = decoder.decode(
    column('texturePreviewSha', (b, o, n) => new Uint8Array(b, o, n)),
  );
  const previewPixels = column('texturePreviewPixels', (b, o, n) => new Uint8Array(b, o, n));
  const [pagePrefix, pageSuffix] = slim.binary.pageUrl.split('{sha}');
  const [geometryPrefix, geometrySuffix] = slim.binary.geometryUrl.split('{sha}');
  const [bundlePrefix, bundleSuffix] = slim.binary.bundleUrl.split('{sha}');
  return {
    pages: {
      bounds,
      sphere,
      parentSphere,
      error,
      ints,
      words,
      geometryWords,
      pageShaText,
      geometryShaText,
      pageDepthLayer,
    },
    groups: {
      groupLevel,
      groupError,
      groupSphere,
      groupChildCount,
      groupOutputCount,
      groupChild,
      groupOutput,
      structureRoot,
    },
    bundles: { bundleWords, bundleShaText },
    previews: { count: counts.previews, previewWords, previewShaText, previewPixels },
    cullingNodes,
    urls: { pagePrefix, pageSuffix, geometryPrefix, geometrySuffix, bundlePrefix, bundleSuffix },
  };
}
