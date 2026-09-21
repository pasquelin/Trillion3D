// Batch H2: the bounded pool of module workers, proved with real `worker_threads` threads
// behind `NodeDomWorker`. Hostile inputs: a runner dead on construction, a runner that dies
// after starting, a cancel with no effect on work already settled.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createPageDecodePool } from './pageDecodePool.ts';
import {
  DeadNodeWorker,
  FlakyNodeWorker,
  NodeDomWorker,
  withNodeWorkerShim,
} from './bench/oracles/pageDecodeNodeWorker.ts';

test('the startup probe answers before any real work, even if submitted in the same breath', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    const pool = createPageDecodePool(1);
    const ordre: string[] = [];
    const demarrage = pool.start().then((ok) => {
      ordre.push('demarrage');
      return ok;
    });
    // Submitted without waiting for the probe: a single worker exists, so its work waits in the queue.
    const decodage = pool.submit('decode', new ArrayBuffer(64), 1 << 20).answer.then((reponse) => {
      ordre.push('decodage');
      return reponse;
    });
    assert.equal(await demarrage, true);
    await decodage;
    assert.deepEqual(ordre, ['demarrage', 'decodage'], 'decode overtook the startup probe');
    pool.retire();
  }));

test('a runner dead on construction fails startup without ever blocking', () =>
  withNodeWorkerShim(DeadNodeWorker as unknown as typeof NodeDomWorker, async () => {
    const pool = createPageDecodePool(2);
    assert.equal(await pool.start(), false);
    assert.equal(pool.alive, false);
  }));

test('a runner that dies after a successful start answers PAGE_DECODE_WORKER to the next job', () =>
  withNodeWorkerShim(FlakyNodeWorker as unknown as typeof NodeDomWorker, async () => {
    const pool = createPageDecodePool(1);
    assert.equal(await pool.start(), true, 'the first answer must succeed');
    assert.equal(pool.alive, true);
    const reponse = await pool.submit('decode', new ArrayBuffer(64), 1 << 20).answer;
    assert.equal(reponse.ok, false);
    assert.equal((reponse as { code: string }).code, 'PAGE_DECODE_WORKER');
    assert.equal(pool.alive, false, 'the pool must be broken after the worker dies');
    // A dead pool answers at once, without ever trying a new runner.
    const apres = await pool.submit('decode', new ArrayBuffer(8), 1 << 20).answer;
    assert.equal((apres as { code: string }).code, 'PAGE_DECODE_WORKER');
  }));

test('cancelling an unknown or already-settled id does nothing and does not break the pool', () =>
  withNodeWorkerShim(NodeDomWorker, async () => {
    const pool = createPageDecodePool(1);
    assert.equal(await pool.start(), true);
    const { id, answer } = pool.submit('verify', new ArrayBuffer(8), 0);
    await answer; // already settled: no owner left.
    assert.doesNotThrow(() => pool.cancel(id));
    assert.doesNotThrow(() => pool.cancel(999999));
    assert.equal(pool.alive, true);
    pool.retire();
  }));
