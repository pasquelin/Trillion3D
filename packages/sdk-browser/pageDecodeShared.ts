/**
 * L'arène de pages en mémoire partagée : la zone de contrôle, l'état d'un créneau et l'attente de
 * son réveil. Un seul écrivain par zone — chaque worker possède un créneau et la région qui lui
 * correspond, et il est le seul à y écrire ; le fil principal ne fait qu'y lire.
 *
 * L'état d'un créneau vit dans la zone de contrôle et ne change que par `Atomics` :
 *
 *   `free` → `decoding` (le fil principal arme le créneau avant de poster la requête)
 *          → `ready`    (le worker a fini d'écrire sa région et publie)
 *          → `consumed` (le fil principal a recopié la page hors de la région)
 *          → `free`     (le créneau reprend du service)
 *
 * `lost` remplace `ready` quand le worker meurt au milieu d'une page : l'attente se réveille, la
 * région n'est pas lue, et le créneau redevient `free`. Il n'y a jamais de boucle d'attente : le
 * fil principal se suspend une fois sur `Atomics.waitAsync`, et l'écriture de l'état par le worker
 * — une écriture atomique séquentiellement cohérente — rend visibles du même coup les octets de la
 * région écrits avant elle.
 */
export const SHARED_FREE = 0,
  SHARED_READY = 2,
  SHARED_CONSUMED = 3;
const SHARED_DECODING = 1,
  SHARED_LOST = 4;
/** La page est venue par transfert de tampons (page trop grande, refus, annulation), ou par la
 *  région partagée. Le fil principal ne lit la région que dans le second cas. */
export const SHARED_BY_REGION = 1;
const SHARED_BY_MESSAGE = 0;

/** Les champs d'un créneau, en mots de 32 bits, et la place réservée à chacun. */
export const MAX_SHARED_ATTRS = 8,
  ATTR_BASE = 10;
const SLOT_I32 = 32;
export const STATE = 0,
  ID = 1,
  STATUS = 2,
  VERTEX = 3,
  FLAGS = 4,
  DECODED = 5,
  WASM = 6,
  TASK_US = 7,
  INDEX_BYTES = 8,
  ATTRS = 9;
/** La région d'un créneau. Une page qui n'y tient pas repart par transfert : la borne coûte de la
 *  mémoire à tous les créneaux, elle n'est donc pas taillée sur le pire cas du format. */
export const SHARED_REGION_BYTES = 4 * 1024 * 1024;

export type PageArena = {
  buffer: SharedArrayBuffer;
  control: Int32Array;
  slots: number;
  /** Premier octet des régions, juste après la zone de contrôle. */
  base: number;
};

/** L'attente asynchrone des `Atomics`, absente de la bibliothèque TypeScript du dépôt (ES2023). */
type WaitAsync = (
  typedArray: Int32Array,
  index: number,
  value: number,
) =>
  | { async: false; value: 'not-equal' | 'timed-out' }
  | { async: true; value: Promise<'ok' | 'timed-out'> };
const waitAsync = () =>
  typeof Atomics === 'undefined'
    ? undefined
    : (Atomics as unknown as { waitAsync?: WaitAsync }).waitAsync;

/**
 * Vrai quand la page peut lire une mémoire partagée : l'isolement entre origines est en vigueur,
 * `SharedArrayBuffer` existe, et l'attente asynchrone aussi — sans elle il faudrait une boucle, ce
 * que ce chemin refuse. Faux partout ailleurs, et le chemin de transfert reste en place tel quel.
 */
export function sharedPagesAllowed() {
  return (
    globalThis.crossOriginIsolated === true &&
    typeof SharedArrayBuffer !== 'undefined' &&
    typeof waitAsync() === 'function'
  );
}

/** Le chemin que prendront les pages décodées, tel qu'il est annoncé aux capacités de l'explorateur. */
export function pageDecodeTransport(): 'partage' | 'transfert' {
  return sharedPagesAllowed() ? 'partage' : 'transfert';
}

const controlBytes = (slots: number) => slots * SLOT_I32 * 4;

/** Une arène neuve pour `slots` workers : zone de contrôle puis une région par créneau. */
export function createPageArena(slots: number): PageArena {
  return attachPageArena(
    new SharedArrayBuffer(controlBytes(slots) + slots * SHARED_REGION_BYTES),
    slots,
  );
}

/** La même arène vue du worker, qui n'en reçoit que le tampon et le nombre de créneaux. */
export function attachPageArena(buffer: SharedArrayBuffer, slots: number): PageArena {
  return {
    buffer,
    control: new Int32Array(buffer, 0, slots * SLOT_I32),
    slots,
    base: controlBytes(slots),
  };
}

export const slotField = (slot: number, field: number) => slot * SLOT_I32 + field;
export const regionAt = (arena: PageArena, slot: number) => arena.base + slot * SHARED_REGION_BYTES;
export const sharedField = (arena: PageArena, slot: number, field: number) =>
  Atomics.load(arena.control, slotField(slot, field));

/** Le créneau passe à `decoding` pour la requête `id` : armé avant que la requête ne soit postée. */
export function beginSharedPage(arena: PageArena, slot: number, id: number) {
  Atomics.store(arena.control, slotField(slot, ID), id);
  Atomics.store(arena.control, slotField(slot, STATUS), SHARED_BY_MESSAGE);
  Atomics.store(arena.control, slotField(slot, STATE), SHARED_DECODING);
}

/**
 * L'état du créneau une fois sorti de `decoding`. Une seule suspension, jamais une boucle : si le
 * worker a déjà publié, `waitAsync` le dit tout de suite ; sinon son écriture de l'état réveille.
 */
export function awaitSharedPage(arena: PageArena, slot: number): Promise<number> {
  const index = slotField(slot, STATE);
  const read = () => Atomics.load(arena.control, index);
  const wait = waitAsync()!(arena.control, index, SHARED_DECODING);
  return wait.async ? wait.value.then(read) : Promise.resolve(read());
}

/** Déclare perdue la page d'un créneau dont le worker vient de mourir, et réveille son attente. Sans
 *  effet sur un créneau qui a déjà publié : ces octets-là sont complets et restent lisibles. */
export function loseSharedPage(arena: PageArena, slot: number) {
  const index = slotField(slot, STATE);
  const was = Atomics.compareExchange(arena.control, index, SHARED_DECODING, SHARED_LOST);
  if (was === SHARED_DECODING) Atomics.notify(arena.control, index);
}

/** Le créneau reprend du service, que sa page ait été lue ou perdue. */
export function freeSharedPage(arena: PageArena, slot: number) {
  Atomics.store(arena.control, slotField(slot, STATE), SHARED_FREE);
}
