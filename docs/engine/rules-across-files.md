# Rules across files

- **The source contract**: a mesh, material, model, cell or world the scene gains joins the running
  session in place (`addPlacements`, `PlacementGrowth`, `growth/webgpuGrowth.ts`), a world-DAG
  model included (`world/models/modelJoin.ts`); one the device refuses is said once as
  `content-refused` (`noticeRefused`) and the running cut kept. A session opens again for a lost
  device and for an option, nothing else.

- **One mechanism per concern**: one transform tree, one host boundary, one depth convention, one
  cut rule and one residency, one irradiance basis, one fog law, one two-step drawing of physics.
  A second one beside it is a defect.
- **Never per frame**: no pipeline compiled on the frame that first needs it (the frame is held,
  `frame/loop/framePipelines.ts`); no wait on a readback; no allocation in a steady frame; no work
  in a held frame — a view without temporal accumulation where nothing moved
  (`frame/loop/hold.ts`); no bounce pass once converged.
- **The jitter stays in the image**: the cut reads it only in the render matrix its boxes are
  projected with and the frustum planes of that matrix — a box the raster covers in the half pixel
  it moves is never rejected before it —, never in a level of detail or a request; the stochastic
  terms converge in the temporal history, which accumulates them over the jitter's phases.
