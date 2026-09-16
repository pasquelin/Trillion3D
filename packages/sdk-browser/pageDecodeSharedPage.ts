import { PAGE_DECODE_PROTOCOL } from '../sdk-core/index.ts';
import {
  ATTRS,
  ATTR_BASE,
  DECODED,
  FLAGS,
  ID,
  INDEX_BYTES,
  MAX_SHARED_ATTRS,
  SHARED_BY_REGION,
  SHARED_CONSUMED,
  SHARED_READY,
  SHARED_REGION_BYTES,
  STATE,
  STATUS,
  TASK_US,
  VERTEX,
  WASM,
  regionAt,
  slotField,
} from './pageDecodeShared.ts';
import type { PageArena } from './pageDecodeShared.ts';
import type { PageDecodeDone } from '../sdk-core/index.ts';

/**
 * Une page décodée dans la région d'un créneau, et la même page relue par le fil principal.
 *
 * La région porte, dans cet ordre : les indices, chaque attribut dans l'ordre du décodage, puis les
 * noms d'attributs en UTF-8. Les longueurs vivent dans la zone de contrôle ; les noms voyagent tels
 * quels plutôt que déduits des drapeaux, pour qu'un attribut nouveau n'oblige à rien ici.
 *
 * Les indices et les attributs font un multiple de quatre octets, et la zone de contrôle aussi :
 * chaque vue typée tombe donc sur un alignement valide, sans remplissage.
 */
const encoder = new TextEncoder(),
  decoder = new TextDecoder();

/**
 * Écrit la page et publie le créneau. Faux — sans rien écrire — quand elle ne tient pas dans la
 * région ou porte plus d'attributs que le plan : l'appelant reprend alors le chemin de transfert,
 * qui rend exactement les mêmes octets.
 */
export function writeSharedPage(arena: PageArena, slot: number, done: PageDecodeDone) {
  const page = done.decoded;
  if (!page || page.names.length > MAX_SHARED_ATTRS) return false;
  const names = page.names.map((name) => encoder.encode(name));
  let bytes = page.indices.byteLength;
  for (const buffer of page.attributes) bytes += buffer.byteLength;
  for (const name of names) bytes += name.byteLength;
  if (bytes > SHARED_REGION_BYTES) return false;
  const region = new Uint8Array(arena.buffer, regionAt(arena, slot), bytes);
  let offset = 0;
  const put = (source: Uint8Array) => {
    region.set(source, offset);
    offset += source.byteLength;
  };
  put(new Uint8Array(page.indices));
  for (const buffer of page.attributes) put(new Uint8Array(buffer));
  for (const name of names) put(name);
  const control = arena.control,
    base = slotField(slot, 0);
  control[base + VERTEX] = page.vertexCount;
  control[base + FLAGS] = page.flags;
  control[base + DECODED] = page.decodedBytes;
  control[base + WASM] = done.wasm ? 1 : 0;
  control[base + TASK_US] = Math.round(done.taskMs * 1000);
  control[base + INDEX_BYTES] = page.indices.byteLength;
  control[base + ATTRS] = names.length;
  for (let k = 0; k < names.length; k++) {
    control[base + ATTR_BASE + 2 * k] = names[k].byteLength;
    control[base + ATTR_BASE + 2 * k + 1] = page.attributes[k].byteLength;
  }
  // Ces deux écritures atomiques publient tout ce qui précède : un lecteur qui voit `ready` voit
  // aussi la région et les longueurs, entières.
  Atomics.store(control, base + STATUS, SHARED_BY_REGION);
  Atomics.store(control, base + STATE, SHARED_READY);
  Atomics.notify(control, base + STATE);
  return true;
}

/** Les octets d'une tranche de la région, recopiés dans un tampon à soi. La région est réutilisée
 *  dès que le créneau redevient libre : rien de ce qui sort d'ici ne peut rester une vue dessus. */
function copyOut(arena: PageArena, offset: number, bytes: number) {
  const copy = new Uint8Array(bytes);
  copy.set(new Uint8Array(arena.buffer, offset, bytes));
  return copy.buffer as ArrayBuffer;
}

/**
 * La page publiée dans un créneau, relue en réponse du contrat et marquée `consumed`. Les tampons
 * rendus sont ceux d'une réponse ordinaire : l'appelant ne voit pas par où la page est passée.
 */
export function readSharedPage(arena: PageArena, slot: number): PageDecodeDone {
  const control = arena.control,
    base = slotField(slot, 0);
  const count = control[base + ATTRS];
  let offset = regionAt(arena, slot);
  const indices = copyOut(arena, offset, control[base + INDEX_BYTES]);
  offset += control[base + INDEX_BYTES];
  const attributes: ArrayBuffer[] = [];
  for (let k = 0; k < count; k++) {
    const bytes = control[base + ATTR_BASE + 2 * k + 1];
    attributes.push(copyOut(arena, offset, bytes));
    offset += bytes;
  }
  const names: string[] = [];
  for (let k = 0; k < count; k++) {
    const bytes = control[base + ATTR_BASE + 2 * k];
    names.push(decoder.decode(new Uint8Array(copyOut(arena, offset, bytes))));
    offset += bytes;
  }
  const done: PageDecodeDone = {
    protocol: PAGE_DECODE_PROTOCOL,
    id: control[base + ID],
    ok: true,
    sha256: null,
    source: null,
    decoded: {
      indices,
      names,
      attributes,
      vertexCount: control[base + VERTEX],
      flags: control[base + FLAGS],
      decodedBytes: control[base + DECODED],
    },
    wasm: control[base + WASM] === 1,
    // Le temps de la tâche traverse la zone de contrôle en microsecondes entières : un compteur,
    // jamais une valeur d'image.
    taskMs: control[base + TASK_US] / 1000,
  };
  Atomics.store(control, base + STATE, SHARED_CONSUMED);
  return done;
}
