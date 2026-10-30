# Hair strands: coverage mapping

`hairVisibilityCoverageMapping` (`false`) takes the share of a pixel the strands cover from their
count and mean width, mapped through a table of the coverage of that many randomly placed strands of
that width, instead of the product of what each strand lets through. Strands are counted in a second
pass over the ribbons; the tiles with strands and their pixels' coverage follow the mapped
transmittance. Needs `hairStrands`.

```js
// Strands whose pixel coverage comes from their count and mean width.
const world = createWorld('viewer', { hairStrands: true, hairVisibilityCoverageMapping: true })
```
