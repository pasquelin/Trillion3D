# Sampled lighting: guide filter
`sampledLightsGuideByHistoryFilter` (`true`) joins the sets of lights each 8-pixel tile saw and did not see with its four neighbours' before they guide the next image of the sampled lighting; it works only while `sampledLightsGuideByHistory` is on.

```js
// Sampled lighting where each tile guides the draw by its own lights alone.
const world = createWorld('viewer', { sampledLights: true, sampledLightsGuideByHistoryFilter: false })
```
