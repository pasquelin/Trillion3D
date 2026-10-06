import { EngineError } from '../../../sdk-core/src/contracts/cache.ts';
import { emitContacts } from './contacts.ts';
import { eventsAt, type FromPhysics, type PhysicsResults } from './protocol.ts';
import type { SessionParts } from './sessionParts.ts';

type Message<T extends FromPhysics['type']> = Extract<FromPhysics, { type: T }>;

/** The states one tick delivered: the poses, the contacts, the character, the wheels, and the
 *  counts a frame reads; the buffer goes back to the worker. */
function receiveResults(c: SessionParts, posed: SessionParts['bodies'], m: PhysicsResults) {
  const { s, stats, bodies, worker, writer } = c,
    began = performance.now(),
    words = new Uint32Array(m.buffer);
  s.reached = Math.max(s.reached, m.step);
  const moved = c.poses.receive(words, m.poses, posed, m.steps) + c.soft.receive(m.soft, m.steps);
  emitContacts(words, eventsAt(c.budget), m.events, bodies.meshOf, c.touched);
  c.character.hear?.(m.character, m.feet, m.steps);
  c.vehicles.receive(m.vehicles, m.steps);
  s.redraw = true;
  if (m.resting) c.link.rested(m.heard, m.step);
  // The last tick before sleep changes the count even when it moves nothing: a frame shows it.
  const changed =
    moved > 0 || m.active !== stats.active || !!m.character || !!m.feet || !!m.vehicles;
  Object.assign(stats, { active: m.active, poses: m.poses, events: m.events });
  stats.droppedEvents += m.dropped;
  stats.bodies = bodies.count.bodies;
  if (m.steps) Object.assign(stats, { stepMs: m.stepMs / m.steps, stepMaxMs: m.stepMaxMs });
  worker.postMessage({ type: 'buffer', buffer: m.buffer }, [m.buffer]);
  writer.recycle(m.spent);
  s.received += performance.now() - began;
  if (changed) c.invalidate();
}

/** Soft bodies brought back to a good state stay: counted, and named in an error that stops
 *  nothing, once a second at most (one brought back at every step would flood the console). */
function receiveRecovered(c: SessionParts, data: Message<'recovered'>) {
  c.stats.softRecoveries += data.bodies.length;
  const now = performance.now();
  if (now - c.s.namedAt < 1000) return;
  c.s.namedAt = now;
  const names = data.bodies.flatMap((id) => c.bodies.meshOf(id)?.name ?? []);
  const message = `Physics: ${data.bodies.length} soft body(ies) diverged and were brought back to their last good state.`;
  c.failed(new EngineError('PHYSICS_DIVERGED', message, names.length ? { names } : {}), false);
}

/** The worker refused or lost bodies: refused shapes leave, tiles and cooked soft bodies by their
 *  owner; diverged, joints break. */
function receiveRefused(c: SessionParts, data: Message<'error'>) {
  for (const id of data.bodies ?? []) c.tiles.refused(id);
  const refused = (data.bodies ?? []).map(c.bodies.meshOf).filter((mesh) => mesh !== null);
  for (const mesh of refused) c.retire(mesh.physics._index, data.code === 'PHYSICS_DIVERGED');
  const names = refused.map((mesh) => mesh.name);
  c.failed(new EngineError(data.code, data.message, names.length ? { names } : {}), data.fatal);
}

/** The page listens to its worker. */
export function listenToWorker(c: SessionParts) {
  // A body asleep or diverged for good breaks its joints.
  const posed = { ...c.bodies, retire: (index: number) => c.retire(index, true) };
  c.worker.onmessage = ({ data }: MessageEvent<FromPhysics>) => {
    if (data.type === 'ready') {
      c.s.ready = true;
      c.onReady();
      c.invalidate();
    } else if (data.type === 'results') receiveResults(c, posed, data);
    else if (data.type === 'rest') c.link.rested(data.heard, data.step);
    else if (data.type === 'broken') c.joints.broke(data.joints);
    else if (data.type === 'recovered') receiveRecovered(c, data);
    else if (data.type === 'cast') {
      c.casts.get(data.id)?.(data.hits);
      c.casts.delete(data.id);
    } else receiveRefused(c, data);
  };
  c.worker.onerror = (event) =>
    c.failed(new EngineError('PHYSICS_FAILED', `Physics worker: ${event.message}`), true);
}
