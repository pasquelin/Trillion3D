/** A source rank as the tables write it — a core node's (`TableNode.sourceNode`) or a cell row's
 *  (`CellNode.sourceNode`) — eight lowercase hexadecimal digits, fixed-width through the partition's
 *  renumbering: the rank itself, or `undefined` for anything else. */
export function parseSourceRank(value: unknown): number | undefined {
  return typeof value === 'string' && /^[0-9a-f]{8}$/.test(value)
    ? Number.parseInt(value, 16)
    : undefined
}
