// Equivalence harness of CMP-10 (#960, E0), on the reference encoder and the JavaScript decoder:
// a page that stores each position once decodes to the very bytes develop's page decoded to, and
// the WebAssembly module decodes it alike. Develop's outcome of every case — the SHA-256 of the
// decoded block, or the refusal — and its page bytes are frozen below, measured on develop
// `a563999f0` with this same harness (`positions.fixture.ts`).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { encodeGeometryPage } from '../../../../page-codec/geometryPage.ts';
import { CLUSTER_HEADER_WORDS } from '../../cluster/format.ts';
import { decodeGeometryPage } from './geometryPage.ts';
import { readGeometryPageHeader } from './geometryPageHeader.ts';
import { decodeGeometryPageWasm, prepareSdkWasm } from './geometryPageWasm.ts';
import { cases, outcome } from './positions.fixture.ts';

const DEVELOP: [string, string, number][] = [
  ['random 0', 'ce4e9d777c652ce7', 132],
  ['random 1', 'cf9a7a9210014c61', 9760],
  ['random 2', '96bec2214239054d', 508],
  ['random 3', 'ed2e46a581059889', 3452],
  ['random 4', 'e5f09fe1302b6ec0', 152],
  ['random 5', 'd42fdec6fff9ba2b', 2288],
  ['random 6', 'adef2fcf59340a0e', 3244],
  ['random 7', '7d1730930dfd1234', 288],
  ['random 8', 'f9da6b78bd7a0f57', 756],
  ['random 9', 'c0cb14cbfd1a01ad', 3512],
  ['random 10', 'e8961ee55b500b88', 2732],
  ['random 11', '8858bdc354867d3b', 800],
  ['random 12', 'b73790d81ada21e2', 7352],
  ['random 13', '08dc11248bbcaa23', 1984],
  ['random 14', 'ded8253e49d42a86', 664],
  ['random 15', '9d654e745d016188', 5692],
  ['random 16', '13db4b83bac5ffb5', 1372],
  ['random 17', 'd3ec5ab7040111e1', 1108],
  ['random 18', '583ac2c9551e974f', 1308],
  ['random 19', 'db7a1fafa923c7af', 5228],
  ['random 20', 'fbc0ab3a847f194b', 652],
  ['random 21', '7ad4596333454ad0', 4068],
  ['random 22', '5ea28d9e30ed7629', 176],
  ['random 23', 'aea4f7190e49f0a0', 432],
  ['random 24', '33a036d852e63c29', 3676],
  ['random 25', '1b5e5e2cbc43c298', 1856],
  ['random 26', '345fa6d5ec4e1436', 192],
  ['random 27', '1d939615356116eb', 772],
  ['random 28', 'bde97e475ea87714', 8432],
  ['random 29', 'c8a6b958af520d56', 316],
  ['random 30', '76571450fc56214e', 780],
  ['random 31', '46e7c4c764f071bf', 1188],
  ['random 32', 'a9cc1bfe697c54bf', 448],
  ['random 33', '58ecb9b0cbacd1fa', 2396],
  ['random 34', 'cffce01fd7acf470', 1736],
  ['random 35', '43594dfb22b851db', 712],
  ['random 36', '2df963a6e3d73250', 172],
  ['random 37', '5554fba4700e898a', 2292],
  ['random 38', 'f78f69addb45dc91', 1688],
  ['random 39', '043427e154c40fef', 8116],
  ['signed zeros', '127336cdcc2ae738', 208],
  ['NaN position', 'PAGE_ATTRIBUTE_NONFINITE', 0],
  ['+Inf position', 'PAGE_ATTRIBUTE_NONFINITE', 0],
  ['-Inf position', 'PAGE_ATTRIBUTE_NONFINITE', 0],
  ['empty', 'PAGE_TRIANGLES_INVALID', 0],
  ['65,535 vertices', '37e1a2b7c03c9364', 851864],
  ['65,538 vertices', 'PAGE_VERTEX_LIMIT', 0],
  ['widest range', '20228dfc9efe4e82', 124],
  ['range past 24 bits', 'PAGE_ATTRIBUTE_RANGE', 0],
];

test('every page decodes to the block develop decoded, with only the format-7 header overhead; flat-shaded pages in fewer', () => {
  const all = cases();
  assert.equal(all.length, DEVELOP.length);
  let [before, after, flatBefore, flatAfter] = [0, 0, 0, 0];
  all.forEach(([name, mesh], i) => {
    const [digest, bytes] = outcome(mesh),
      [was, outcomeWas, bytesWas] = DEVELOP[i];
    assert.equal(name, was);
    assert.equal(digest, outcomeWas, name);
    // Format 7 adds one u32 influence-count word; decoded static attributes stay identical.
    const headerGrowth = bytesWas ? (CLUSTER_HEADER_WORDS - 24) * 4 : 0;
    assert.ok(bytes <= bytesWas + headerGrowth, `${name}: ${bytes} > ${bytesWas + headerGrowth}`);
    [before, after] = [before + bytesWas, after + bytes];
    if (mesh.indices.every((corner, k) => corner === k))
      [flatBefore, flatAfter] = [flatBefore + bytesWas, flatAfter + bytes];
  });
  console.log(`pages ${before} -> ${after} bytes; flat-shaded ${flatBefore} -> ${flatAfter}`);
  assert.ok(flatAfter < flatBefore);
});

test('a flat-shaded page decodes alike in JavaScript and WebAssembly; a stray link is refused', async () => {
  const module = readFileSync(join(import.meta.dirname, 'pageCodec.wasm'));
  assert.ok(await prepareSdkWasm(module));
  const [, mesh] = cases().find(([name]) => name === '65,535 vertices')!;
  const { data } = encodeGeometryPage(mesh.indices, mesh.attributes, mesh.exponent);
  const { vertexCount, positionCount, linkBits, streams } = readGeometryPageHeader(data);
  assert.ok(positionCount < vertexCount, `${positionCount} positions for ${vertexCount} vertices`);
  const js = decodeGeometryPage(data as Uint8Array, 1 << 28),
    wasm = await decodeGeometryPageWasm((data as Uint8Array).slice(), 1 << 28);
  assert.deepEqual(new Uint8Array(wasm.indices.buffer), new Uint8Array(js.indices.buffer));
  // The first link set to its widest rank, past the stored positions: refused on both sides.
  assert.ok(2 ** linkBits > positionCount);
  const forged = (data as Uint8Array).slice(),
    first = new DataView(forged.buffer, (CLUSTER_HEADER_WORDS + streams.links) * 4, 4);
  first.setUint32(0, first.getUint32(0, true) | (2 ** linkBits - 1), true);
  for (const decode of [decodeGeometryPage, decodeGeometryPageWasm])
    await assert.rejects(async () => decode(forged.slice(), 1 << 28), /GEOMETRY_PAGE_BOUNDS/);
});
