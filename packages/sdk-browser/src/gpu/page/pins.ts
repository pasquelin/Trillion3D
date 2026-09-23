import type { GpuPageContext } from './types.ts';

export function createGpuPagePins(context: GpuPageContext) {
  const { resident, pins, free, check, reader } = context;
  const { emit } = reader;
  return {
    pin(key: string) {
      check();
      const page = resident.get(key);
      if (!page) {
        emit('gpu-page-pin-refused', 'GPU pin refused', () => ({
          version: 1,
          key,
          reason: 'not-resident',
        }));
        throw new Error('PAGE_NOT_RESIDENT');
      }
      const changed = !pins.has(key);
      pins.add(key);
      if (changed)
        emit('gpu-page-pin', 'GPU page pinned', () => ({
          version: 1,
          key,
          slot: page.slot,
          generation: page.generation,
          changed,
          pinned: pins.size,
        }));
    },
    /**
     * Moves a resident page to the far end of the eviction order, without a load: a page a
     * lower tier still wants is then the last unpinned page a new arrival takes the slot of.
     */
    touch(key: string) {
      const page = resident.get(key);
      if (!page) return false;
      resident.delete(key);
      resident.set(key, page);
      return true;
    },
    /** Slots a load can take without evicting a pinned page: the free ones and the unpinned. */
    unpinnedSlots() {
      return free.length + resident.size - pins.size;
    },
    unpin(key: string) {
      const changed = pins.delete(key);
      if (changed)
        emit('gpu-page-unpin', 'GPU pin removed', () => ({
          version: 1,
          key,
          changed,
          pinned: pins.size,
        }));
    },
  };
}
