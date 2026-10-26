/** A colour attachment held by its call site for the session: its `view` is set before each pass
 *  that uses it, the rest stays as given. */
export const heldColour = (
  init: Omit<GPURenderPassColorAttachment, 'view'>,
): GPURenderPassColorAttachment => ({ view: undefined as never, ...init })
