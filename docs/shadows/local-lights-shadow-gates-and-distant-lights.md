# Local lights' shadow gates and distant lights

Before a point, spot or rectangle light is given maps, the plan asks four gates, in this order, of
each light that casts and whose reach the view sees (`lighting/shadows/vsm/localGate.ts`,
`lighting/shadows/vsm/frame/vsmPlan.ts`): a light that casts no shadow is asked for none of them. A
light that fails one takes no map, no page and no projection that frame, and its cache waits
unreferenced:

1. `shadowPointLightShadows` (`true`): a point or rectangle light takes a shadow at all. A spot is not concerned.
2. `shadowResolutionScaleZeroDisables` (`true`): a light whose `shadowResolutionScale` is 0 takes none.
3. `shadowPointLightCubemaps` (`true`): a point or rectangle light takes its shadow as a cube of faces; off, it takes none.
4. The fade. The light's radius in pixels (a spot's: that of the sphere inscribed in the end of its cone; the distance from
   the eye never under 1 cm) times its kind's texels per pixel (`shadowTexelsPerPixelPoint` 1.27324,
   `shadowTexelsPerPixelSpot` 2.54648, `shadowTexelsPerPixelRect` 1.27324) is its resolution; its own scale and the most
   (`shadowMaxResolution`, 2048, less the 4-texel border of a spot's map each side, never under 0: a cap
   smaller than the borders leaves a spot no shadow, it does not lift the cap) hold it. The shadow is whole
   above `shadowFadeResolution` (64), gone at and below `shadowMinResolution` (32), and between them fades by
   `shadowFadeExponent` (0.25); a fade of 1/256 or less takes no shadow. `shadowFadeUsesResolutionScale` (`true`) says whether
   the fade reads the resolution after the light's own scale.

The quality levels write `shadowMaxResolution` (512, 1024, 1024 below `max`, 2048). The gates read the view the plan is made for: its projection, its eye and its size in pixels.

```js
const world = createWorld('viewer', { shadowMinResolution: 16, shadowFadeResolution: 32 }) // keep small far lamps longer
world.shadows = { shadowPointLightCubemaps: false } // point and rectangle lights take no shadow; spots keep theirs
world.shadows = { shadowPointLightCubemaps: null } // back to the default
```

A rectangle light takes the six faces of a point light's cube, as deep as its `range`: its source is
its panel, so its penumbra is traced toward its centre through a cone whose radius is half its width, and a
surface behind its plane is outside its shadow region (a surface exactly in the plane is in front: the
rectangle lights it).

## Distant lights

A local light whose finest needed mip is the last one — its map fits in one page — is distant
(`shadowDistantLightMode`, `1`; `2` makes every local light distant, `0` none; `vsm/distantLights.ts`). A
distant light takes the last mip alone, its page always marked (whatever `shadowMarkCoarsePagesLocal` says). It is
drawn once, then kept whatever moves: the invalidations of the casters leave it alone, and it is drawn again
only on its turn, or where its own key changes: it moves, is turned, is resized or stops being distant. Each
frame `shadowMaxDistantUpdatePerFrame` (`1`) of the distant lights whose cache is whole — the ones left longest
first — have their turn (`-1` every one, `0` none: then a distant light is drawn again only where its key
changes). At or under that count every distant light has its turn at every frame — a lone far lamp is drawn
each frame, as with the mode off —; only above it do they take turns, so that a scene of many far lamps pays
for a few a frame. The turns go once a scene frame, however many views draw it: the first view's setup takes
them, the others' none (the distant lights' maps are shared by every view). A distant light's first two frames are drawn, as any light's: the second turns its maps from
uncached to cached.

```js
world.shadows = { shadowDistantLightMode: 0 } // no light is distant: every local light follows its casters
world.shadows = { shadowMaxDistantUpdatePerFrame: 4 } // up to four distant lights a frame
```
