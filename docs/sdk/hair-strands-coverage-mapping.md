# Hair strands: coverage mapping
`hairVisibilityCoverageMapping` (`false`) takes the share of a pixel the strands cover from their count and their mean width, mapped through a table of the coverage of that many strands of that width placed at random, instead of the product of what each strand lets through. The strands are counted in a second pass over the ribbons; the tiles with strands and the coverage of their pixels follow the mapped transmittance. It needs `hairStrands`.

```js
// Strands whose pixel coverage comes from their count and mean width.
const world = createWorld('viewer', { hairStrands: true, hairVisibilityCoverageMapping: true })
```
