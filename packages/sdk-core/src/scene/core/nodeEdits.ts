/** How many times any scene node was renamed or changed parent since the page loaded: an answer
 *  found by walking names — the engine's name index of a prepared scene — holds while it stands. */
let edits = 0;

/** The current count: compare it with the one an answer was built under. */
export const objectEdits = () => edits;

/** A name or a parent changed. */
export const noteObjectEdit = () => void edits++;
