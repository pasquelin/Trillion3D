// #573: the WebGL2 path pages a dynamic geometry by its index alone, drawn over its host lists; any
// other page still needs its geometry page.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GEOMETRY_PAGE_CODEC,
  GEOMETRY_PAGE_FORMAT_VERSION,
  type ClusterManifest,
  type Page,
} from '../../../../sdk-core/src/index.ts';
import { prepareAutonomousManifest } from './manifest.ts';

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
