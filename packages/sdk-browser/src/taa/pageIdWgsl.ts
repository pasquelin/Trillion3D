import { VIS_CARD_BASE } from '../visibility/visWords.ts'

/**
 * The test, as WGSL text, that visibility identifier `id` names no page: the background (0) or a
 * card's pixel (`VIS_CARD_BASE | slot`, `visibility/visWords.ts`). The temporal passes read both as
 * they read the background — no row, no motion of a placement —, as they read a card before it was
 * tagged. Text, not a function: each pass's block keeps to its own declarations.
 */
export const NO_PAGE_ID = `id==0u||id>=${VIS_CARD_BASE}u`
