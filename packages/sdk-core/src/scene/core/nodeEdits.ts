/** How many times any scene node was renamed or changed its child list since the page loaded: an
 *  answer found by walking names — the engine's name index of a prepared scene — holds while it
 *  stands. Counted where a name and a child list change (`TransformNode.name`, `SceneNode`). */
let edits = 0;

/** The current count: compare it with the one an answer was built under. */
export const objectEdits = () => edits;

/** A name or a child list changed. */
export const noteObjectEdit = () => void edits++;
