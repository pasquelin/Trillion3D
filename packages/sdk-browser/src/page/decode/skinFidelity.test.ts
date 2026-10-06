import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { encodeGeometryPage } from '../../../../page-codec/src/geometryPage.ts';
import { decodeGeometryPage } from './geometryPage.ts';
import { decodeGeometryPageWasm, prepareSdkWasm } from './geometryPageWasm.ts';
import { restorePageDecode, runPageDecodeTask } from './task.ts';
import { PAGE_DECODE_PROTOCOL } from '../../../../sdk-core/src/page/decodeContracts.ts';

const attr = (values: number[], itemSize: number) => ({
  array: new Float32Array(values),
  itemSize,
});
function page(weights = Array(8).fill(0.125)) {
  return encodeGeometryPage(
    [0, 1, 2],
    {
      POSITION: attr([0, 0, 0, 1, 0, 0, 0, 1, 0], 3),
      JOINTS_0: attr(Array(3).fill([0, 1, 2, 3]).flat(), 4),
      WEIGHTS_0: attr(Array(3).fill(weights.slice(0, 4)).flat(), 4),
      JOINTS_1: attr(Array(3).fill([4, 5, 6, 7]).flat(), 4),
      WEIGHTS_1: attr(Array(3).fill(weights.slice(4)).flat(), 4),
    },
    -8,
    undefined,
    [
      {
        POSITION: attr(
          [0.12345679, -1234.5678, 0.000001].flatMap((v) => [v, v, v]),
          3,
        ),
      },
    ],
  ).data;
}

test('all eight influences and exact float32 deltas survive JS, WASM and worker transfer', async () => {
  assert.ok(await prepareSdkWasm(readFileSync(new URL('./pageCodec.wasm', import.meta.url))));
  const data = page(),
    js = decodeGeometryPage(data),
    wasm = await decodeGeometryPageWasm(data);
  const { answer } = await runPageDecodeTask({
    protocol: PAGE_DECODE_PROTOCOL,
    id: 1,
    op: 'decode',
    source: data.slice().buffer,
    maxDecodedBytes: 1 << 24,
  });
  assert.ok(answer.ok && answer.decoded);
  const worker = restorePageDecode(answer.decoded);
  for (const decoded of [js, wasm, worker]) {
    assert.equal(decoded.skinInfluences, 8);
    assert.deepEqual([...decoded.attributes.skinIndex.slice(0, 8)], [0, 1, 2, 3, 4, 5, 6, 7]);
    const weights = decoded.attributes.skinWeight.slice(0, 8);
    assert.equal(
      weights.reduce((x, w, j) => x + w * (j >= 4 ? 8 : 0), 0),
      4,
    );
    for (const [v, source] of [0.12345679, -1234.5678, 0.000001].entries())
      assert.equal(decoded.attributes.morph[v * 6], Math.fround(source));
  }
});

test('half weights keep the source position with joints separated by 1000 units', () => {
  const decoded = decodeGeometryPage(page([0.5, 0.5, 0, 0, 0, 0, 0, 0]));
  assert.equal(decoded.attributes.skinWeight[1] * 1000, 500);
});
