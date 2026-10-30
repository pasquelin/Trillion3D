# HLOD

A job builds an HLOD only when it names one, and only over the objects it assigns a layer. The HLOD
is a list of layers, each with its builder, its settings and the layer its cells' actors are built
by (`parent`): an object names its layer, and follows its layer's chain of parents, one actor per
layer and cell, each layer's actors streamed on its own grid ([The partition's
grids](the-partitions-grids.md#the-partitions-grids)): its `cellSize` and `loadingRange`, 256 m and
512 m when it names none — the simple form doubles both level by level, with four levels HLOD 0 to 3
on 256, 512, 1 024 and 2 048 m cells loaded within 512 m to 4 096 m —, a chain's top, its last
layer's actors, streamed on its own grid like any layer's (`spatiallyLoaded` defaults to `true`:
past its loading range nothing stands for them); set `spatiallyLoaded: false` on the last layer to
keep them always loaded, so the view is never limited. Two chains — trees and buildings — build
distinct actors over the same ground. Every level's actor is built from its cell's original objects
— every object under the cell, its shape and its texture —, never from the actors of the level
below: the actors of every level are built side by side, as many at once as the memory allows.

Any layer may take objects, and its actors are then their HLOD 0, one per main cell and layer: an
`instanced` layer's are the objects themselves, their cell rows loaded within that layer's grid
range; any other layer builds its HLOD 0 actor of them, first drawn past the main grid's range,
where their main cell goes. A layer's level is its deepest step up any chain from a layer the
scene's objects take; a layer no such chain reaches builds nothing and streams on no grid. Any layer
may build another's cells' actors — an `instanced` one makes each object its source mesh placed —,
save a parent that wears its sources' own materials (`instanced`, or `merge` keeping its materials)
above a layer whose actors wear materials of their own, which the job refuses. A layer not spatially
loaded lets the parent it names go: nothing is built of actors always loaded.

The rest, by topic:

- [Assignment and marks](hlod/assignment-and-marks.md)
- [The two forms](hlod/the-two-forms.md)
- [Layer settings](hlod/layer-settings.md)
- [Distance fields and chart examples](hlod/distance-fields-and-chart-examples.md)
- [Refusals and the merge atlas](hlod/refusals-and-the-merge-atlas.md)
- [GPU baking](hlod/gpu-baking.md)
- [Simplified layers](hlod/simplified-layers.md)
- [Translucent sources](hlod/translucent-sources.md)
