// #573: the WebGL2 path draws a dynamic geometry's index pages over its host lists, every page
// sharing them, and uploads a rewrite once, by its written range alone (`bufferSubData`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { Geometry } from '../../../../sdk-core/src/world/geometry/geometry.ts';
import { BufferAttribute } from '../../../../sdk-core/src/world/buffer/attribute.ts';
import {
  GEOMETRY_PAGE_CODEC,
  GEOMETRY_PAGE_FORMAT_VERSION,
  type ClusterManifest,
  type Page,
} from '../../../../sdk-core/src/index.ts';
import { WebglClusterGeometry } from '../../webgl/cluster/geometry.ts';
import { markRewritten } from '../../world/core/worldDynamicRanges.ts';
import { prepareAutonomousManifest } from './manifest.ts';
import { sourcedPageGeometry } from './sourcedPages.ts';

/** A context that keeps the vertex-list uploads, `[kind, byte offset, bytes]`, and nothing else. */
function listContext() {
  const uploads: [string, number, number][] = [];
  let buffers = 0;
  const call = () => {};
  const gl = new Proxy(
    {
      ARRAY_BUFFER: 34962,
      ELEMENT_ARRAY_BUFFER: 34963,
      FLOAT: 5126,
      UNSIGNED_INT: 5125,
      createBuffer: () => ({ id: buffers++ }),
      bufferData(target: number, array: ArrayBufferView) {
        if (target === 34962) uploads.push(['data', 0, array.byteLength]);
      },
      bufferSubData(target: number, at: number, array: Float32Array, start = 0, count = 0) {
        if (target === 34962) uploads.push(['sub', at, (count || array.length - start) * 4]);
      },
    },
    { get: (known, name: string) => (known as Record<string, unknown>)[name] ?? call },
  );
  return { gl: gl as unknown as WebGL2RenderingContext, uploads, buffers: () => buffers };
}

test('a dynamic primitive is paged by its index alone on WebGL2; any other page still needs its geometry page', () => {
  const page = { url: 'blob:corners', sha256: 'a', bytes: 12, count: 3 } as Page;
  const manifest = (dynamic: boolean) =>
    ({
      geometryPages: { formatVersion: GEOMETRY_PAGE_FORMAT_VERSION, codec: GEOMETRY_PAGE_CODEC },
      primitives: [{ mesh: 0, primitive: 0, pass: 'exact-clusters', pages: [page], dynamic }],
    }) as unknown as ClusterManifest;
  const read = prepareAutonomousManifest(manifest(true));
  assert.deepEqual([...read.sourced.keys()], ['blob:corners']);
  assert.equal(read.metadata.primitives[0].pages[0].url, 'blob:corners', 'read at its own address');
  assert.throws(() => prepareAutonomousManifest(manifest(false)), /AUTONOMOUS_PAGE_MISSING/);
});

test('the pages of a dynamic geometry share its lists, and a rewrite uploads its range once', () => {
  // A world's host geometry holds its lists as 32-bit floats (`worldMirror.ts`).
  const source = new Geometry(),
    position = new BufferAttribute(new Float32Array(12), 3);
  source.setAttribute('position', position);
  const pages = [0, 1].map(() =>
    sourcedPageGeometry(Uint32Array.of(0, 1, 2), source, [-1, -1, -1], [1, 1, 1]),
  );
  const { gl, uploads, buffers } = listContext();
  const cache = new WebglClusterGeometry(gl, {
    position: 0,
    normal: -1,
    uv: -1,
    uv1: -1,
    color: -1,
  });
  for (const page of pages) cache.bind(page);
  const lists = buffers() - pages.length; // an index buffer each
  assert.equal(lists, 1, 'one buffer for the position list both pages read');
  assert.deepEqual(uploads, [['data', 0, position.array.byteLength]]);
  position.setZ(1, 0.5);
  position.setZ(2, 0.5);
  markRewritten(source, [{ name: 'position', from: 1, count: 2 }]);
  uploads.length = 0;
  for (const page of pages) cache.bind(page);
  assert.deepEqual(uploads, [['sub', 12, 24]], 'vertices 1 and 2, once');
});
