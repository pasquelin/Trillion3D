# Local lights' shadow gates and distant lights

Four gates, in order, for each casting local light the view sees
(`lighting/shadows/vsm/localGate.ts`, `lighting/shadows/vsm/frame/vsmPlan.ts`). A failing light takes
no map, page or projection that frame:

1. `shadowPointLightShadows` (`true`): point or rectangle lights take a shadow. Spots excluded.
2. `shadowResolutionScaleZeroDisables` (`true`): `shadowResolutionScale` 0 takes none.
3. `shadowPointLightCubemaps` (`true`): point or rectangle lights take a cube; off, none.
4. The fade. Resolution = radius in pixels (spot: sphere inscribed in the cone's end; eye distance
   at least 1 cm) times texels per pixel (`shadowTexelsPerPixelPoint` 1.27324,
   `shadowTexelsPerPixelSpot` 2.54648, `shadowTexelsPerPixelRect` 1.27324), bounded by its scale and
   `shadowMaxResolution` (2048, less a spot's 4-texel border each side; a smaller cap leaves a spot
   no shadow). Whole above `shadowFadeResolution` (64), gone at or below
   `shadowMinResolution` (32), fading by `shadowFadeExponent` (0.25) between; a fade of 1/256 or
   less takes no shadow. `shadowFadeUsesResolutionScale` (`true`): fade reads the scaled resolution.

Quality levels set `shadowMaxResolution` (512, 1024, 1024, 2048).

```js
const world = createWorld('viewer', { shadowMinResolution: 16, shadowFadeResolution: 32 }) // keep small far lamps longer
world.shadows = { shadowPointLightCubemaps: false } // point and rectangle lights take no shadow; spots keep theirs
world.shadows = { shadowPointLightCubemaps: null } // back to the default
```

A rectangle light takes a point light's six cube faces, as deep as its `range`; penumbra traced
toward its centre through a cone of half its width; a surface behind its plane is lit.

## Distant lights

A local light whose finest needed mip is the last (map fits one page) is distant
(`shadowDistantLightMode`, `1`; `2` every local light, `0` none; `vsm/distantLights.ts`). It takes
the last mip alone, page always marked (whatever `shadowMarkCoarsePagesLocal` says). Drawn once,
then kept (caster invalidations skip it); redrawn on its turn or when its key changes (moved,
turned, resized). Each frame `shadowMaxDistantUpdatePerFrame` (`1`) distant
lights with a whole cache, longest-waiting first, get a turn (`-1` all, `0` none: key change only).
Turns go once per scene frame, whatever the view count.

```js
world.shadows = { shadowDistantLightMode: 0 } // no light is distant: every local light follows its casters
world.shadows = { shadowMaxDistantUpdatePerFrame: 4 } // up to four distant lights a frame
```
