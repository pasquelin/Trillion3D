/**
 * How many times any scene object was renamed, or gained or lost a child, since the page loaded.
 *
 * A reader that keeps an answer found by walking a subtree by name — the engine's name index of a
 * prepared scene — holds it only while this count stands: an unchanged count means no name and
 * no parent changed anywhere, so the walk would answer the same. One integer, bumped by the
 * setters themselves (`TransformNode`), whatever called them.
 */
let edits = 0;

/** The current count: compare it with the one an answer was built under. */
export const objectEdits = () => edits;

/** A name or a parent changed. */
export const noteObjectEdit = () => void edits++;
