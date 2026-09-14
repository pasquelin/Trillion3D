import type { GpuPageContext } from './gpuPageTypes.ts';

export function createGpuPagePins(context: GpuPageContext) {
  const { resident, pins, check, reader } = context;
  const { emit } = reader;
  return {
    pin(key: string) {
      check();
      const page = resident.get(key);
      if (!page) {
        emit('gpu-page-pin-refused', 'Épinglage GPU refusé', () => ({
          version: 1,
          key,
          reason: 'not-resident',
        }));
        throw new Error('PAGE_NOT_RESIDENT');
      }
      const changed = !pins.has(key);
      pins.add(key);
      if (changed)
        emit('gpu-page-pin', 'Page GPU épinglée', () => ({
          version: 1,
          key,
          slot: page.slot,
          generation: page.generation,
          changed,
          pinned: pins.size,
        }));
    },
    unpin(key: string) {
      const changed = pins.delete(key);
      if (changed)
        emit('gpu-page-unpin', 'Épinglage GPU retiré', () => ({
          version: 1,
          key,
          changed,
          pinned: pins.size,
        }));
    },
  };
}
