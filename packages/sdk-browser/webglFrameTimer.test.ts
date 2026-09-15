import test from 'node:test';
import assert from 'node:assert/strict';
import { createWebglFrameTimer } from './webglFrameTimer.ts';

const TIME_ELAPSED_EXT = 0x88bf;
const GPU_DISJOINT_EXT = 0x8fbb;
const QUERY_RESULT_AVAILABLE = 0x8867;
const QUERY_RESULT = 0x8866;

/** Un faux WebGL2RenderingContext : une requête = un identifiant, un résultat et une disponibilité. */
function fakeGl(options: { withExtension?: boolean } = {}) {
  const { withExtension = true } = options;
  const results = new Map<number, number>();
  const available = new Set<number>();
  const deleted: number[] = [];
  let created = 0,
    disjoint = false,
    flushes = 0;
  const gl = {
    getExtension: (name: string) =>
      withExtension && name === 'EXT_disjoint_timer_query_webgl2'
        ? { TIME_ELAPSED_EXT, GPU_DISJOINT_EXT }
        : null,
    createQuery: () => ({ id: created++ }),
    beginQuery() {},
    endQuery() {},
    flush() {
      flushes++;
    },
    getQueryParameter: (query: { id: number }, pname: number) =>
      pname === QUERY_RESULT_AVAILABLE ? available.has(query.id) : results.get(query.id),
    getParameter: () => disjoint,
    deleteQuery: (query: { id: number }) => deleted.push(query.id),
    QUERY_RESULT_AVAILABLE,
    QUERY_RESULT,
  } as unknown as WebGL2RenderingContext;
  return {
    gl,
    setDisjoint: (value: boolean) => (disjoint = value),
    markAvailable: (id: number, nanoseconds: number) => {
      available.add(id);
      results.set(id, nanoseconds);
    },
    created: () => created,
    deleted,
    flushes: () => flushes,
  };
}

test('sans extension, le chronomètre annonce non supporté et rien n’est jamais mesuré', () => {
  const timer = createWebglFrameTimer(fakeGl({ withExtension: false }).gl);
  assert.equal(timer.supported, false);
  timer.begin();
  timer.end();
  const polled = timer.poll();
  assert.equal(polled.ms, null);
  assert.equal(polled.reason, 'EXT_disjoint_timer_query_webgl2 absent de cet appareil');
});

test('sans requête en attente, poll explique l’absence plutôt que de rendre zéro', () => {
  const timer = createWebglFrameTimer(fakeGl().gl);
  assert.deepEqual(timer.poll(), { ms: null, reason: 'aucune requête en attente' });
});

test('une requête pas encore prête reste non mesurée, sans être perdue', () => {
  const f = fakeGl();
  const timer = createWebglFrameTimer(f.gl);
  timer.begin();
  timer.end();
  assert.deepEqual(timer.poll(), { ms: null, reason: 'résultat pas encore prêt' });
  assert.equal(f.flushes(), 1);
});

test('une requête disponible et non disjointe donne une durée en millisecondes', () => {
  const f = fakeGl();
  const timer = createWebglFrameTimer(f.gl);
  timer.begin();
  timer.end();
  f.markAvailable(0, 2_500_000);
  assert.deepEqual(timer.poll(), { ms: 2.5, reason: null });
  assert.deepEqual(f.deleted, [0]);
});

test('une requête disjointe est jetée avec sa raison, jamais publiée comme une durée', () => {
  const f = fakeGl();
  f.setDisjoint(true);
  const timer = createWebglFrameTimer(f.gl);
  timer.begin();
  timer.end();
  f.markAvailable(0, 1_000_000);
  assert.deepEqual(timer.poll(), {
    ms: null,
    reason: 'le pilote a interrompu la mesure (GPU_DISJOINT_EXT)',
  });
});

test('au-delà du seuil de requêtes en attente, plus aucune nouvelle requête n’est ouverte', () => {
  const f = fakeGl();
  const timer = createWebglFrameTimer(f.gl);
  for (let i = 0; i < 6; i++) {
    timer.begin();
    timer.end();
  }
  // MAX_PENDING = 4 : la 5e requête est encore admise (pending.length passe de 4 à 5), la 6e est refusée.
  assert.equal(f.created(), 5);
});
