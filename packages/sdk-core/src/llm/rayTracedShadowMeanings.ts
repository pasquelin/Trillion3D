import type { RayTracedShadowField } from '../contracts/rayTracedShadowOptions.ts'

/** What the view's ray-traced shadow settings mean (`../contracts/rayTracedShadowOptions.ts`). */
export const RAY_TRACED_SHADOW_MEANINGS: Readonly<Record<RayTracedShadowField, string>> = {
  rayTracedShadows:
    "Whether the lights that follow the view's setting (castRayTracedShadow 'useProjectSetting', a light's default) cast their shadow by rays cast through the scene's triangles instead of the shadow maps (false, the default). Only a device that traces rays through triangles takes them; elsewhere the shadow maps stay.",
  rayTracedShadowsDirectionalLights:
    'Whether directional lights may cast ray-traced shadows (true, the default), whatever they or rayTracedShadows ask.',
  rayTracedShadowsPointLights:
    'Whether point lights may cast ray-traced shadows (true, the default), whatever they or rayTracedShadows ask.',
  rayTracedShadowsSpotLights:
    'Whether spot lights may cast ray-traced shadows (true, the default), whatever they or rayTracedShadows ask.',
  rayTracedShadowsRectLights:
    'Whether rect lights may cast ray-traced shadows (true, the default), whatever they or rayTracedShadows ask.',
  rayTracedShadowsSamplesPerPixel:
    "The rays a pixel casts to each light (-1, the default, leaves it to the light's rayTracedShadowSamplesPerPixel, 1 by default).",
  rayTracedShadowsNormalBias:
    "The most, in centimetres (0.1 by default, at least 0.01), a shadow ray's start is moved along the surface normal to leave the triangle it starts on.",
  rayTracedShadowsAvoidSelfIntersectionTraceDistance:
    "The length, in centimetres (1 by default), of the short first ray that leaves the pixel's own surface behind, culling back faces; 0 casts no such ray.",
  rayTracedShadowsTwoSidedGeometry:
    'Whether geometry casts ray-traced shadows from both faces (true, the default); false passes back faces.',
  rayTracedShadowsAcceptFirstHit:
    'Whether a shadow ray ends at the first primitive it meets rather than the nearest (true, the default); it may denoise worse in some cases.',
}
