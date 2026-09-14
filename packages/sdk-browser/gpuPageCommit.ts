import type { GpuPageContext, ResidentPage } from './gpuPageTypes.ts';

/** Reserves a slot, evicts only an unpinned page, and uploads one complete fixed-size GPU slot. */
export function commitGpuPage(
  context: GpuPageContext,
  key: string,
  bytes: Uint8Array,
  requestStarted: number,
): ResidentPage {
  const {
    state,
    free,
    resident,
    pins,
    slots,
    changeKeys,
    changeSlots,
    staging,
    device,
    buffer,
    pageBytes,
    reader,
  } = context;
  const { emit, now, report } = reader;
  state.bytesRead += bytes.byteLength;
  let slot = free.pop();
  if (slot === undefined) {
    let victim: ResidentPage | undefined;
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
    resident.delete(victim.key);
    changeKeys.push(victim.key);
    changeSlots.push(-1);
    slot = victim.slot;
    state.evictions++;
    emit('gpu-page-eviction', 'Page évictée de la résidence GPU', () => ({
      version: 1,
      key: victim!.key,
      slot: victim!.slot,
      generation: victim!.generation,
      bytes: victim!.bytes,
      reason: 'capacity',
      drawDetached: false,
    }));
  }
  const uploadStarted = now();
  staging.fill(0, bytes.byteLength);
  staging.set(bytes);
  device.queue.writeBuffer(buffer, slot * pageBytes, staging);
  const uploadDurationMs = report ? performance.now() - uploadStarted : null;
  state.uploadedBytes += pageBytes;
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
    uploadedBytes: pageBytes,
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
    uploadedBytes: pageBytes,
    durationMs: report ? performance.now() - requestStarted : null,
  }));
  return page;
}
