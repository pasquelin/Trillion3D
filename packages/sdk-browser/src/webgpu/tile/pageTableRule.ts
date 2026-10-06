/**
 * Writes a page table sends at its next flush: the words that changed, in runs, never a
 * texture's whole span between two far apart. Runs closer than `gap` words are sent as one, and
 * past `cap` runs the ones across the smallest gaps are joined, so a flush makes at most that many
 * `writeBuffer` calls. Both declared, not derived: they weigh a call against the bytes a joined gap
 * resends, and change no word the GPU reads.
 */
export const PAGE_TABLE_RULE = { gap: 16, cap: 64, overflow: 'narrowest' } as const
