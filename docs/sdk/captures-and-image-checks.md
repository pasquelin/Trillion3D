# Captures and image checks

`capture.surface(world, { width, height })` and `capture.buffer(world, { width, height })` return
pixels taken aside from the view. A deterministic image: `world.camera.set(pose)`,
`await world.awaitPages()`, `world.render()`, then `await capture.buffer(...)`. `awaitPages()`
rejects a requested URL that failed to load (a background load is retried three times at most); it
waits for pages, not an image.

A capture draws its view `cutViewCaptureDelay` images (4 by default; less than 1 reads as 1), the
first being the one that finds its cut whole, and reads the last. The temporal antialiasing the
world has on runs in the capture from that first image, accumulating them from a history of its own
that the capture's view releases with it; under 4 images the last, the one that is read, is drawn
without it. One image is drawn without it. The capture shows no motion blur. The main view's history
is untouched.

```ts
world.cut = { cutViewCaptureDelay: 8 } // eight images, the antialiasing accumulating all of them
const { data } = await capture.buffer(world, { width: 3840, height: 2160 })
world.cut = { cutViewCaptureDelay: 2 } // two images, the last drawn without temporal antialiasing
world.cut = { cutViewCaptureDelay: 1 } // one image, no temporal antialiasing in the capture
```
