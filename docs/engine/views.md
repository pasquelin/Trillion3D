# Views

A world draws its own camera as the runtime's main view, then each view `world.addView` made
(`session/world/views.ts`), in the same frame and loop (`frame/schedule/draw.ts`). A view is a record of
what a camera owns (`frame/backend/state/view.ts`): its cut and what its image made of it, motion, Hi-Z
pyramid (read by its next image's cut occlusion), frame targets, temporal history, effect chain,
presenter (own canvas, or a rectangle of the main canvas), GPU timer and render scale
(`view/viewScale.ts`, following the world's controller within its bounds). Drawing it trades those
members into the runtime groups and back (`frame/backend/state/viewSwitch.ts`). Every other member is
the scene's and shared: placements and their composition, pages, their residency (the union of every
view's cut under the one budget), pools, materials, lights, physics and pipelines.

The virtual shadow maps share their pool, page tables and local lights' maps; a sun's clipmap follows
the eye, so each view keeps its own cache entry (`VsmCacheManager.view`), carried unreferenced while
other views draw and aged by its own view's frames; the pool is asked for every view's pixels. The
projection mask and light grid keep the largest layout a view asked, so views of other sizes drawn in
turn lay nothing out again. The main view's GPU sample adds the views' last GPU time, each over the main
images between its draws, to the frame the `'auto'` scale fits.
