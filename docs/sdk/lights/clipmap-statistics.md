# Clipmap statistics

`shadowShowClipmapStats` (`-1`, off) writes over the image, upper left, the statistics of the sun
shadow clipmap of that index (`0` the first): per level, the rect of pages its map has allocated
(lowest and highest page of each axis) and, where the rect is not empty, its width, height and area in
pages; last, the total area of the levels. The rects are copied from the page management's table and
read a few images late, so the figures follow the view with a short delay.

```js
world.shadows = { shadowShowClipmapStats: 0 } // the first sun's clipmap: allocated page rects and total area
world.shadows = { shadowShowClipmapStats: -1 } // off
```
