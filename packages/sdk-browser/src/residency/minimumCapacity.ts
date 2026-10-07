import type { ClusterRoot, PageRec } from '../page/selection/types.ts'

/**
 * THE MINIMUM CAPACITY (#1237, the #484 follow-up): memory never forces a cut the view refuses.
 *
 * The cook drops a part only at a level whose error covers it, so a root drops every part smaller
 * than its published error. Drawn at a view that refuses that error, it loses them: a lost column.
 * The smallest pool therefore holds, beside the root cover, the pages of the group each root
 * replaces — one level finer, where the cook kept those parts —, and admits them before any other
 * page the view asks for, whatever their level: a root the view refuses is then replaced by its
 * children, and a root the view accepts is drawn as before, its children never asked for. The
 * slots this rule costs are the pool's floor with the root cover (`geometryPoolFor`, `root-cover`)
 * and published with it; they follow the roots the view holds, never the world (#483 rule 6).
 *
 * Marks each page of the group a root of `roots` replaces (`rootChild`) and returns them, one
 * record per placement: the caller counts them by its own key.
 */
export function rootChildren(roots: readonly ClusterRoot<PageRec>[]): PageRec[] {
  const found: PageRec[] = []
  for (const { structure, pages } of roots) {
    if (!structure) continue
    const { roots: tops, sources, childOffsets, children } = structure
    for (const top of tops) {
      const group = sources[top]
      if (group < 0) continue
      for (let i = childOffsets[group]; i < childOffsets[group + 1]; i++) {
        const page = pages[children[i]]
        if (page.rootChild) continue
        page.rootChild = true
        found.push(page)
      }
    }
  }
  return found
}

/** The level a page is ranked at when levels are counted (`requestAdmission.ts`): its own, raised
 *  past `top`, the catalogue's highest level, when the minimum capacity holds it. */
export const admissionLevel = (rec: PageRec, top: number) =>
  (rec.level ?? 0) + (rec.rootChild ? top + 1 : 0)

/** What the minimum capacity costs, published once its pool is drawn (`minimum-capacity`): the
 *  root cover's pages and the floor's, which adds the pages the roots' groups replace. */
export const floorDiagnostic = (rootPages: number, floorPages: number) =>
  [
    'minimum-capacity',
    'Pool floor: the root cover and the pages its groups replace',
    { rootPages, floorPages },
  ] as const
