# Presentation

A session presents through its own canvas context; a world keeps its device across sessions,
each creating through its own handle (`gpu/core/sessionHandle.ts`, `gpu/core/deviceOwners.ts`,
`gpu/core/errorScope.ts`).

The composition writes the display colour and the canvas in one draw (two attachments) where something reads the
display colour, and the canvas alone otherwise (a pipeline compiled at the first such frame; until then both are
written), so the image is tone mapped once. A reader that finds the display colour left behind (`displayStale`: a
capture, the host's image readback) has the pose drawn again with it, and a held frame the canvas lost draws instead
of presenting it. The display colour is the copy a capture, a view placed at a rectangle of the canvas
and an offscreen composition read, and it stays because the canvas cannot serve them
(§ 21.2 and § 21.4 of the WebGPU specification). `getCurrentTexture()` gives the texture of the frame
being drawn, and it expires when the frame is presented ("Expire the current texture"); the drawing
buffer outlives it, but the only way to write it again is a new `getCurrentTexture()`, which replaces
the buffer ("Replace the drawing buffer": a blank one) — so a GPU copy of what a frame presented, asked
after the frame as a capture is, has no source on the canvas, and the canvas read as an external
image (`copyExternalImageToTexture`, "other Web APIs") converts its colour as the implementation does,
not bit for bit. A view placed at a rectangle redraws its part each frame for the same reason: the
canvas's buffer is replaced at each new texture. Adding `COPY_SRC` to the canvas's `usage` (§ 21.4, the
default is `RENDER_ATTACHMENT` alone) changes none of this. A still view that fills the canvas draws
nothing again: the buffer keeps its pixels, dither included, until a texture is taken
(`presenter.holds`, `frame/loop/hold.ts`).
