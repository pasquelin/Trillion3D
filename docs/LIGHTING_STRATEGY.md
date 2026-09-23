# Lighting — the target and the web strategy

The end goal of this engine, and the order it is reached in. The geometry, the temporal
antialiasing and the memory budgets are the foundation; this is what they are for. Each stage is
measured before the next is started, and a stage out of order is not out of scope.

Nothing here is copied from any engine: what follows comes from public material — SIGGRAPH talks
of 2021 and 2022, published documentation — and from what this engine already has.

End goal: the reference's lighting — dynamic global illumination, reflections, shadows — at its
performance, on the web.

What the reference is made of, and our counterpart:

| Reference piece                                   | Role                                                         | What we have today                                           | What is missing |
| ------------------------------------------------- | ------------------------------------------------------------ | ------------------------------------------------------------ | --------------- |
| Temporal antialiasing                             | denoises everything stochastic                               | shipped, 0 px A/A                                            | —               |
| Screen traces                                     | first shot of every ray: image depth and normal, almost free | nothing                                                      | L1              |
| Distance fields (per mesh, then global)           | off-screen rays without hardware ray tracing                 | certified-error resident proxy, walked triangle by triangle  | L4              |
| Surface cache                                     | radiance of off-screen surfaces, updated under budget        | one radiance per triangle and proxy face, swept under budget | L4              |
| Screen probes (16 px grid) + world radiance cache | final gather, temporally filtered                            | cascaded SH2 world probes; no screen probe                   | L5              |
| Reflections                                       | screen traces, then distance fields reading the cache        | none                                                         | L1, L6          |
| Virtual shadow maps                               | 16k shadow pages, only the views, cached                     | 4096 atlas, page-cached sliding cascades, 1 ms budget        | L3              |
| Stochastic direct lighting                        | few samples per pixel, denoised                              | tiled culling; four draws per moving pixel, exact at rest    | L2 (denoise)    |

What the web imposes, and the answer:

- **No hardware ray tracing**: the reference's software path — screen traces first, distance
  fields next — is the one taken; the distance field is baked by the compiler, like textures, at a
  resolution fixed by the budget.
- **Bounded, unreadable memory**: what streams enters a host-set byte reservoir, never read off
  the machine ([memory budgets](SDK.md#memory-budgets), adjustable in session), and displays coarser if it does not fit, never refused; image targets
  follow resolution with no ceiling.
- **One browser frame**: each piece has a millisecond budget and a reading by envelope difference;
  lot order follows what the measurement says costs, not preference.
- **No persistent threads, eight storage buffers per stage**: worked around as for the DAG cut
  and the compute raster.

Stages, each with its proof (0 px A/A at rest, budget held, before/after published):

- **L0** — done (campaign of 18 Sept. 2026, Emerald 2496×1404): the sun is 4.7 ms of
  envelope on the ground view and 5.8 ms on the street view (`mobile` − `sans-lumiere`); lighting
  without maps ≤ 0.96 ms (`lampes-4-sans-ombres` − `sans-lumiere`); still camera: 0 page redrawn,
  envelope no lower. What remained, the sampling, is L2 below — not a cascade ring.
- **L1** — screen traces: reflections and short bounce from the already-rendered HDR, depth and
  normal; the cheapest piece of the reference, and the first.
- **L2** — sampling done (#36, 20 Sept. 2026, Emerald 2496×1404, ground view, 32 shadowed
  lights reaching one pixel): a moving pixel weighs every light of its tile without its shadow,
  shades the four it draws — exactly those worth a sample's share, stratified for the rest —
  and the history averages the draws; a still image shades every light and converges to the
  exact sum, 0 px A/A. Envelope 39.9 → 17.9 ms GPU on a moving camera; the grain left in motion
  is declared in [ENGINE.md](ENGINE.md#direct-lighting). What remains of L2: a spatial denoise before the history,
  where the reference has one.
- **L3** — shadows in virtual pages from the hardware raster only the pages seen,
  cached. The compute raster is off, on measurement.
- **L4** — baked global distance field, walked in compute, reading the proxy's surface cache.
- **L5** — screen probes gathering L1 and L4, filtered by temporal history; world probes
  for the far field; bounce on by default when its budget holds.
- **L6** — rough reflections and materials.

Exit criterion: on the same scene and the same machine as the reference, same image
to the eye, same byte budgets, same millisecond envelope.
