# Cloud sizes, drawing and orthographic views

**Orthographic views.** Under an orthographic camera each pixel's ray leaves the pixel's own point on
the near plane and runs along the view's direction, the same for every pixel; its depth, the scene's
depth cut and the layer test are measured from that point. A pixel whose ray starts inside the layer's
outer sphere shows no cloud (the camera is in the sky), and the scene's depth cuts a ray only where the
layer ends before the far plane. The view is traced directly, a ray per pixel, with no history and no
enlarging, and laid over the lit image as it is traced (the ways that enlarge a reduced image read the
eye's rays, which an orthographic view lacks). The air is drawn as well ([the air under an
orthographic camera](../atmosphere-and-sky-light.md#atmosphere-and-sky-light)).

**Sizes and upsamplings.** The four sizes (a quarter traced, half rebuilt, then enlarged; half; a
quarter rebuilt at the full size; full) and the five ways to lay the image over the scene (bilinear,
bilinear with a jitter, nearest with a depth test, jittered with the depth test, bilateral) are the
reference's, step for step: the trace and rebuild factors, the order of the pixels traced over the
images of a cycle (2×2: 0 2 3 1; 4×4: 0 8 2 10 12 4 14 6 3 11 1 9 15 7 13 5), where the fog is laid
late (the quarter-to-half and quarter-to-full sizes), which sizes force the nearest way, the jitter's
four directions, the bilateral choice among the two surfaces of four texels, and its fall back to a
soft bilinear read. The scene's depth is read at the last coordinate of the depth image the trace
uses: the view's size less one over a texel of that image in view pixels (the view's size for the
quarter-to-full and full sizes and a direct trace, half of it for the others).

**The cloud material.** The material's mask term adds to the coverage times (profile + noise); the
layout's placement offset does not move the mask (the placement is added back to the mask's
coordinates) while it moves the pattern, as in the material the layout comes from; the wind carries
the three noise offsets by `wind · alpha · time / tile` on all three axes.

**Drawing.** The sky is premultiplied radiance over the HDR image where the colour pass left the
background, with no fog in its own draw: the fog pass lays the fog's height law over it like over any
pixel ([Fog](../fog.md#fog), the sky), so exposure, the curve and the temporal resolve treat it as any
surface. The haze (aerial perspective) is read by every surface, over the fog, opaque and transparent
alike: `L' = L · T + S`. Opaque surfaces get it from the fog pass via the haze volume as a 3D texture
(`fogOpaque`, `hazeSampledWgsl`); translucent layers through the light buffer, where the volume lives
behind the fog's block (`lighting/atmosphere/layout.ts`; `fogged`, `fogOver`, `lighting/fogShader.ts`).
The fog takes the sky's mean radiance on as its own colour and scatters the sun's light on the ground
([Fog](../fog.md#fog)). A scene without an atmosphere reads none of it. The unlit view and the views that
paint raw values show none. The sky's draw binds no fog: the light shafts' occlusion mask is read by
the fog pass (`DEFERRED_BINDINGS.fogLightShaft`).

**The air under an orthographic camera.** The sky, the haze on the surfaces and the haze on the clouds
are drawn as under a perspective one, from a ray starting where the pixel's does: the point of the near
plane under the pixel, raised by half the view's height along the planet's up (so the bottom row of a
view standing on the ground starts from the eye's height, not from under the ground), running along the
view's direction, the same for every pixel (`airRay`, `airRayWgsl.ts`). The raise is worked out once
per image, on the CPU, from the view's matrices, and held in the frame (`AirFrame.lift`,
`writeAirFrame`), the programs adding it as it stands. The sky is read from the table around the eye at
the height each pixel starts at; the haze volume is built along those rays, and a surface reads it at
its distance along the view's direction from the near plane, the same for every pixel of the surface's
depth. The sky light's capture, taken from a place of its own, is a perspective view whatever the
camera is.

```js
world.scene.sky = { atmosphere: true, sun: true, clouds: true } // the sky, the haze and the clouds, whatever the camera
// The horizon is seen from the height of the camera's bottom row: raise the camera to look from higher.
camera.position.set(0, 10, 100)
```

