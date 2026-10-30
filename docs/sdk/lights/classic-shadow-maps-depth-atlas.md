# Classic shadow maps' depth atlas

With `shadowVirtualEnable: false` the lights' classic shadow maps are drawn into a depth atlas (a tile a map, a layer for the movable casters and one for the static casters) and joined to the page pool the readers sample. Eight options set it, with the reference defaults:

- `shadowCsmCaching` (`false`): a sun's cascades are drawn whole each image. `true` keeps the pages a sliding cascade still covers, until it has slid so far that less than `shadowCsmScrollingOverlapAreaThrottle` of its cached area is covered (`0.75`), or the last slide had to draw more than `shadowMaxCsmScrollingStaticSubjects` static casters again (`5`); it then draws its cache again whole. While cascades are cached their casters take no slope bias.
- `shadowCacheWholeScene` (`true`): the static depths are kept from one image to the next.
- `shadowCachedCastFromMovable` (`true`): `false` leaves the movable casters out of the point and spot lights' shadows.
- `shadowMaxPointCacheUpdatesPerFrame`, `shadowMaxSpotCacheUpdatesPerFrame` (`-1`, no limit): past the limit a light whose resolution changed keeps its previous resolution that frame.
- `shadowWholeSceneCacheMb` (`150`): memory of every atlas of both layers, counted as 32-bit depth. Maps that do not fit are drawn into the pool without a tile; a sun's cascades never go without: their resolution `shadowMaxCsmResolution` is held to the atlas side less one page, so a cascade the atlas cannot hold is drawn in a coarser clipmap level.

The atlas is drawn into only while the maps are classic, and costs nothing otherwise.

```js
const world = createWorld('viewer', { shadowVirtualEnable: false }) // classic maps, drawn into the atlas
world.shadows = { shadowCsmCaching: true } // cascades reuse the pages they still cover as they slide
world.shadows = { shadowCsmScrollingOverlapAreaThrottle: 0.5, shadowMaxCsmScrollingStaticSubjects: 10 } // slide further before the cache is drawn again
world.shadows = { shadowMaxSpotCacheUpdatesPerFrame: 2 } // at most two spot lights change their resolution a frame
world.shadows = { shadowCachedCastFromMovable: false } // movable casters leave the point and spot lights' shadows
world.shadows = { shadowWholeSceneCacheMb: 300 } // a larger atlas: more room for the lights' tiles
```
