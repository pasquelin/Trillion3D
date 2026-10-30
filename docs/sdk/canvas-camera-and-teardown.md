# Canvas, camera and teardown

The drawing buffer follows the canvas's CSS box, and `pixelRatio` the browser's, unless set;
`world.resize(width, height)` sets a size, omitted arguments reading the CSS box. A canvas hidden or
zero-size at creation needs an explicit `resize()` or showing first; one hidden later keeps its last
size.

`world.pixelError` is the DAG cut's screen error in pixels (`1` by default: a coarser level strays at
most one pixel from the finer one; `0` keeps the exact leaves, a larger value selects coarser pages
when the cache has them). `pose.fromBounds(box)` frames a box, `pose.pointOfInterest(name, pose)` names
one, `pose.runPath(world, poses, { images })` replays a path, one display frame per pose, and answers
the frames drawn, their CPU time summarized and the display cadence.

Render settings and effects:

- [Temporal anti-aliasing settings](canvas-camera-and-teardown/temporal-antialiasing-settings.md)
- [Raster and cut settings](canvas-camera-and-teardown/raster-and-cut-settings.md)
- [Depth pyramid and occlusion settings](canvas-camera-and-teardown/depth-pyramid-and-occlusion-settings.md)
- [Tessellation settings](canvas-camera-and-teardown/tessellation-settings.md)
- [Volumetric lightmap setting](canvas-camera-and-teardown/volumetric-lightmap-setting.md)
- [Global distance field settings](canvas-camera-and-teardown/global-distance-field-settings.md)
- [Distance field occlusion settings](canvas-camera-and-teardown/distance-field-occlusion-settings.md)
- [Surface cache settings](canvas-camera-and-teardown/surface-cache-settings.md)
- [Ambient occlusion](canvas-camera-and-teardown/ambient-occlusion.md)
- [Ambient cubemap, reflection captures and planar reflections](canvas-camera-and-teardown/ambient-cubemap-and-reflection-captures.md)
- [Material pass shading settings](canvas-camera-and-teardown/material-pass-shading-settings.md)
- [Exposure settings](canvas-camera-and-teardown/exposure-settings.md)
- [Render scale, dynamic resolution and frame rate](canvas-camera-and-teardown/render-scale-and-frame-rate.md)
- [Effect chain, bloom and film effects](canvas-camera-and-teardown/effect-chain-bloom-and-film-effects.md)
- [Colour grading](canvas-camera-and-teardown/colour-grading.md)
- [Extra views and disposal](canvas-camera-and-teardown/views-and-disposal.md)
- [Texture filtering settings](canvas-camera-and-teardown/texture-filtering-settings.md)

Camera and scene interaction:

- [Camera controllers](canvas-camera-and-teardown/camera-controllers.md)
- [Picking, moving and saving](canvas-camera-and-teardown/picking-moving-and-saving.md)
- [Live material values](canvas-camera-and-teardown/live-material-values.md)
- [Geometry rewritten every frame](canvas-camera-and-teardown/geometry-rewritten-every-frame.md)
- [Particles: emitters spawning with the world's frames](canvas-camera-and-teardown/particles-emitters-spawning-with-the-worlds-frames.md)
- [Guides: lines, points and helpers over the image](canvas-camera-and-teardown/guides-lines-points-and-helpers-over-the-image.md)
