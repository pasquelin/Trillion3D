import type { GpuPageContext, ResidentPage } from './gpuPageTypes.ts';
import { evictResident } from './gpuPageCommit.ts';

/** Les octets qu'un tampon de pages peut faire sur cet appareil : la plus petite de ses limites. */
export const pageBufferCap = (limits?: {
  maxBufferSize?: number;
  maxStorageBufferBindingSize?: number;
}) => Math.min(limits?.maxBufferSize ?? Infinity, limits?.maxStorageBufferBindingSize ?? Infinity);

export const pageBufferBytes = (device: GPUDevice, pageBytes: number, slots: number) => {
  const size = pageBytes * slots;
  if (!Number.isSafeInteger(slots) || slots < 1 || size > pageBufferCap(device.limits))
    throw new Error('INVALID_PAGE_BUDGET');
  return size;
};

export const createPageBuffer = (device: GPUDevice, size: number) =>
  device.createBuffer({
    label: 'WG geometry page cache',
    size,
    usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST | GPUBufferUsage.COPY_SRC,
  });

/**
 * Le réservoir change de taille SANS perdre ce qu'il tient : la référence, elle, vide son pool
 * quand `StreamingPoolSize` change. Les pages des fentes qui survivent sont copiées sur la carte à
 * la même place ; celles des fentes qui disparaissent sont déplacées dans une fente libre du
 * nouveau réservoir tant qu'il en reste — les épinglées d'abord, puis les plus récentes —, et
 * seulement ensuite évincées. Chaque mouvement passe par le journal des changements, que le
 * miroir de résidence lit comme une arrivée ou un départ ordinaire. Rend les clés évincées,
 * épinglées comprises : l'appelant les désépingle de son côté.
 */
export function resizeGpuPages(context: GpuPageContext, slots: number): string[] {
  const { device, pageBytes, resident, pins, free } = context;
  const size = pageBufferBytes(device, pageBytes, slots);
  const next = createPageBuffer(device, size);
  const encoder = device.createCommandEncoder({ label: 'WG geometry page cache resize' });
  encoder.copyBufferToBuffer(
    context.buffer,
    0,
    next,
    0,
    Math.min(context.slots, slots) * pageBytes,
  );
  // Une passe sur la résidence : les fentes occupées qui survivent, et les pages déplacées — les
  // épinglées d'abord, puis les plus récentes, quand la place manque.
  const occupied = new Uint8Array(slots);
  const displaced: ResidentPage[] = [];
  for (const page of resident.values()) {
    if (page.slot < slots) occupied[page.slot] = 1;
    else displaced.push(page);
  }
  free.length = 0;
  for (let slot = 0; slot < slots; slot++) if (!occupied[slot]) free.push(slot);
  displaced.sort(
    (a, b) => Number(pins.has(b.key)) - Number(pins.has(a.key)) || b.generation - a.generation,
  );
  const evicted: string[] = [];
  let taken = 0;
  for (const page of displaced) {
    if (taken === free.length) {
      evictResident(context, page, 'resize');
      evicted.push(page.key);
      continue;
    }
    const slot = free[taken++];
    encoder.copyBufferToBuffer(context.buffer, page.offset, next, slot * pageBytes, pageBytes);
    page.slot = slot;
    page.offset = slot * pageBytes;
    context.changeKeys.push(page.key);
    context.changeSlots.push(page.offset / 4);
  }
  free.splice(0, taken);
  device.queue.submit([encoder.finish()]);
  context.buffer.destroy();
  context.buffer = next;
  context.slots = slots;
  return evicted;
}
