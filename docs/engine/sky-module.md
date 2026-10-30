# Sky module

The sky is one module (`packages/sdk-core/src/modules/sky/descriptor.ts`, `SKY_MODULE`): the air, the
sun, the sky light, the height fog and the clouds of a new world's level, five parts each switched
alone, off by default. The module manager (`modules/manager.ts`) holds one decision per source
(editor, page, quality, scene) and resolves a module as the strongest source says, per part and per
field (`mergeModuleParts`). A world builds its manager with the sky and stats modules
(`session/world/worldModules.ts`) and starts or stops each, in registration order and the reverse, at
every write of `scene.sky` or `world.modules`.

A module that is off holds nothing. The sky's start is the only place its lights are made and its
parts resolved (`resolveSky`); off, `WorldModules.sky` is `NO_SKY` (no resolved part, no light), the
display carries no fog and no atmosphere, and a pass reading a part reads it from
`modules.sky.resolved`, where an absent part is the pass's gate: no resource made, no pass encoded.
The module's lights hang from no scene (`session/world/skyLights.ts`): the sun is one directional
light aimed by the part's `rotation` (`sunDirection`), the sky light one light of kind `sky`; each
sync shows them after the scene's lights (`session/world/lights.ts`).

**One sky light.** The scene keeps one sky light: the last one shown replaces the others, whose
radiance, irradiance and fog factor are dropped, and the fog scatters that light's own
`fogScattering` (not a sum or mean of several). The sun competes with the scene's directional lights
by the air's rule, the brightest of each index.

```js
world.scene.sky = true // the level: air, sun (6 lux, 6500 K), sky light, height fog, clouds
world.scene.sky = { clouds: false, sun: { shadowsClouds: false } } // two words, one object
world.modules.set('sky', { heightFog: false }) // the page, over the scene's
world.modules.state('sky') // { enabled: true, by: 'scene', parts: { …, heightFog: false } }
```

A sun with `shadowsClouds` makes the cloud march read the sun's opaque shadow map, only for the air's
first light (`cloudsReadOpaqueShadow(light, sunIndex)`, `modules/sky/cloudShadow.ts`). A scene saved
before the module is read once into its parts (`session/saved/legacySky.ts`); its sky light keeps
what that scene said: captured once and again when the scene changes, not every image
(`realTimeCapture` off, `sourceType: 'capturedScene'`), with the light's colour, intensity, ground
colour and volumetric scattering.
