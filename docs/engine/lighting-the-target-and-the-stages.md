# Lighting: the target and the stages

The target: dynamic global illumination, reflections and shadows at desktop-class cost, on the web,
in software, within the host's byte budgets ([SDK.md](../sdk/memory-budgets.md#memory-budgets)). One model lights
every surface: direct light, shadows and bounce are summed in linear radiance, fogged,
then tone-mapped and encoded to sRGB once, at composition.

| Stage                                     | Where                                           |
| ----------------------------------------- | ----------------------------------------------- |
| Temporal antialiasing                     | [Temporal antialiasing](temporal-antialiasing.md#temporal-antialiasing) |
| Stochastic direct light over a light grid | [Direct lighting](direct-lighting.md#direct-lighting)             |
| Shadows                                   | [SHADOWS.md](../SHADOWS.md)                        |
| Probes and distance-field rays            | [Light that bounces](light-that-bounces.md#light-that-bounces)       |
| Screen-space ambient occlusion            | [Ambient occlusion](ambient-occlusion.md#ambient-occlusion)         |
