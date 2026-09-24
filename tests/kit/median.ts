/** The middle value of a series — the upper of the two middle ones for an even count. */
export const median = (values: readonly number[]): number =>
  [...values].sort((a, b) => a - b)[values.length >> 1];
