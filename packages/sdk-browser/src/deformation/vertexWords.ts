/** The words a vertex's results start with: its owner's tag, then its image's; a block's address
 *  lies past the first vertex's. */
export const DEFORM_TAG_WORDS = 2
/** Where each result of a vertex lies from its address, three floats each: its current position,
 *  its previous one, its current normal and its current tangent — what the stage writes and the
 *  page passes read. The tangent's sign is the page's own, which no deformation changes; the
 *  tangent is written for the rows whose page stores tangents alone. */
export const DEFORMED_FIELD = { position: 0, previous: 3, normal: 6, tangent: 9 } as const
/** Words per vertex: the tags, then the four results. */
export const DEFORM_VERTEX_WORDS = DEFORM_TAG_WORDS + 4 * 3
