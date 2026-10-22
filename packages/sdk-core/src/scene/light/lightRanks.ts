/**
 * THE ORDER OF THE LIGHTS WHERE TWO ARE EQUAL: a rank for each, handed out as the slots of a list
 * that leaves a hole when an entry goes. A light added takes the rank freed last, else the next
 * one; a light changed keeps its own. The light store's table packs its lights without holes
 * (the last one fills the removed one's slot), so its order is not the order of adding; the rank
 * is: what settles, among lights of the same luminance, who takes the sun's place when the sun is
 * removed (`atmosphereSun.ts`).
 */
export function createLightRanks() {
  const ranks = new Map<string, number>()
  /** The ranks left free by removed lights, the last one freed on top. */
  const freed: number[] = []
  let next = 0
  return {
    /** The rank of a light held; the lower, the earlier. */
    of: (id: string) => ranks.get(id)!,
    /** Gives a light added its rank. */
    take(id: string) {
      ranks.set(id, freed.pop() ?? next++)
    },
    /** Frees the rank of a light removed. */
    free(id: string) {
      freed.push(ranks.get(id)!)
      ranks.delete(id)
    },
  }
}
