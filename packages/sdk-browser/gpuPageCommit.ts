import type { GpuPageContext, ResidentPage } from './gpuPageTypes.ts';

/** Une page quitte la résidence : le journal des changements et le relevé le disent, d'où que
 *  vienne le départ. La fente n'est pas rendue ici — l'appelant sait ce qu'il en fait. */
export function evictResident(
  context: GpuPageContext,
  page: ResidentPage,
  reason: 'capacity' | 'explicit-unload' | 'resize',
) {
  const { resident, pins, changeKeys, changeSlots, state } = context;
  resident.delete(page.key);
  pins.delete(page.key);
  changeKeys.push(page.key);
  changeSlots.push(-1);
  state.evictions++;
  context.reader.emit('gpu-page-eviction', 'Page retirée de la résidence GPU', () => ({
    version: 1,
    key: page.key,
    slot: page.slot,
    generation: page.generation,
    bytes: page.bytes,
    reason,
    drawDetached: false,
  }));
}

/** Reserves a slot, evicts only an unpinned page, and uploads one complete fixed-size GPU slot. */
export function commitGpuPage(
  context: GpuPageContext,
  key: string,
  bytes: Uint8Array,
  requestStarted: number,
): ResidentPage {
  const { state, free, resident, pins, slots, changeKeys, changeSlots } = context;
  const { staging, device, buffer, pageBytes, reader } = context;
  const { emit, now, report } = reader;
  state.bytesRead += bytes.byteLength;
  let slot = free.pop();
  if (slot === undefined) {
    let victim: ResidentPage | undefined;
    // Tout est épinglé : dit en O(1), sans parcourir la résidence — c'est l'état d'un réservoir
    // plein pour la vue, qui se répète à chaque salve tant que la coupe n'a pas grossi.
    if (pins.size < resident.size)
      for (const page of resident.values()) {
        if (!pins.has(page.key)) {
          victim = page;
          break;
        }
      }
    if (!victim) {
      emit('gpu-page-admission-blocked', 'Aucun slot GPU évictable', () => ({
        version: 1,
        key,
        reason: 'all-pages-pinned',
        resident: resident.size,
        slots,
        pinned: pins.size,
      }));
      throw new Error('ALL_PAGES_PINNED');
    }
    evictResident(context, victim, 'capacity');
    slot = victim.slot;
  }
  const uploadStarted = now();
  // Un slot fait la taille du PLUS GROS cluster de la scène. Écrire le slot entier ferait payer à
  // chaque page — même minuscule — un effacement, une recopie et un transfert de cette taille-là,
  // alors que rien ne lit jamais la queue du slot : une ligne de la table de pages nomme son offset
  // et son nombre de triangles, et la passe de visibilité ne sort pas de cette plage. Seuls les
  // octets de la page partent donc, complétés jusqu'au multiple de quatre que `writeBuffer` exige.
  const size = bytes.byteLength,
    padded = size + (size % 4 ? 4 - (size % 4) : 0);
  staging.set(bytes);
  if (padded !== size) staging.fill(0, size, padded);
  device.queue.writeBuffer(buffer, slot * pageBytes, staging, 0, padded);
  const uploadDurationMs = report ? performance.now() - uploadStarted : null;
  state.uploadedBytes += padded;
  const page = {
    key,
    slot,
    offset: slot * pageBytes,
    bytes: bytes.byteLength,
    generation: ++state.generation,
  };
  resident.set(key, page);
  changeKeys.push(key);
  changeSlots.push(page.offset / 4);
  emit('gpu-page-upload', 'Page écrite dans un slot GPU', () => ({
    version: 1,
    key,
    slot,
    offset: slot * pageBytes,
    generation: page.generation,
    actualDataBytes: bytes.byteLength,
    uploadedBytes: padded,
    uploadDurationMs,
    gpuMs: null,
    drawDetached: false,
  }));
  emit('gpu-page-load-end', 'Chargement GPU terminé', () => ({
    version: 1,
    key,
    slot,
    generation: page.generation,
    actualDataBytes: bytes.byteLength,
    uploadedBytes: padded,
    durationMs: report ? performance.now() - requestStarted : null,
  }));
  return page;
}
