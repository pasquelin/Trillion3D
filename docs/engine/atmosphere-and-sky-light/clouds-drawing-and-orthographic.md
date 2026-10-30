# Cloud sizes, drawing and orthographic views

**Orthographic views.** Each pixel's ray leaves its near-plane point along the view direction; depth,
scene depth cut and layer test are measured from it. A ray starting inside the layer's outer sphere
shows no cloud; scene depth cuts a ray only where the layer ends before the far plane. No
enlarging. Air is drawn ([air under an orthographic
camera](../atmosphere-and-sky-light.md#atmosphere-and-sky-light)).

**Sizes and upsamplings** follow reference: four sizes (quarter traced, half rebuilt, enlarged; half;
quarter rebuilt at full size; full), five upsamplings (bilinear, bilinear with jitter, nearest or
jittered with depth test, bilateral). Pixel trace order over a cycle's images:
2×2: 0 2 3 1; 4×4: 0 8 2 10 12 4 14 6 3 11 1 9 15 7 13 5. Fog is laid late for quarter-to-half and
quarter-to-full. Scene depth is read at the trace depth image's last coordinate: view size less one
over its texel in view pixels (view size for quarter-to-full, full and direct trace; half otherwise).

**Cloud material.** Mask term adds to coverage × (profile + noise); layout placement offset moves the
pattern, not the mask; wind moves the three noise offsets by `wind · alpha · time / tile`.

**Drawing.** Sky = premultiplied radiance over the HDR image where colour pass left background; fog
pass covers it ([Fog](../fog.md#fog)). Haze, on every surface over fog: `L' = L · T + S`. Opaque surfaces get it in the fog pass via the haze volume as a 3D texture
(`fogOpaque`, `hazeSampledWgsl`); translucent layers via the light buffer, volume behind the fog
block (`lighting/atmosphere/layout.ts`; `fogged`, `fogOver`, `lighting/fogShader.ts`). Fog takes sky mean radiance as its colour and reads the
light-shaft mask (`DEFERRED_BINDINGS.fogLightShaft`). No atmosphere, unlit and raw-value views: no
haze.

**Air under an orthographic camera.** Sky, surface haze and cloud haze draw as under perspective,
from a ray starting at the pixel's near-plane point raised by half view height along planet up,
along view direction (`airRay`, `airRayWgsl.ts`); raise computed per image on CPU (`AirFrame.lift`, `writeAirFrame`). Sky is read at each pixel's start height; haze volume is built along those rays; a
surface reads it at its distance along view direction.

```js
world.scene.sky = { atmosphere: true, sun: true, clouds: true } // the sky, the haze and the clouds, whatever the camera
// The horizon is seen from the height of the camera's bottom row: raise the camera to look from higher.
camera.position.set(0, 10, 100)
```
