# The pointer

stdout for one job (abridged):

```json
{
  "status": "ready",
  "key": "80004251…dbd7",
  "scope": "full",
  "url": "80004251…dbd7/clusters.json",
  "pointer": "/abs/cache/native/full/manifest.json",
  "formatVersion": 9,
  "selectedTriangles": 1132930,
  "primitives": 412,
  "metrics": { "importMs": 1571.7, "clusterHierarchyPagesMs": 1822.8, "wallMs": 3411.2 },
  "unsupported": ["hard RSS enforcement", "N-API binding"],
  "reused": null
}
```

`pointer` is the file the browser loads; `url` is relative to `native/<scope>/` in the layout of
[FORMAT.md](../format/layout.md#layout). `key` names the product: the same source, linked resources,
compiler build and options give the same key on any machine, any change another
(`cache/identity.rs`). `metrics` are the run's report, never part of the product, and its phase
durations overlap (`support/perf.rs`). `reused` is `null` when the job wrote the folder, the proof's counts
when it kept one. On failure stdout carries `{"status": "error", "code", "message"}` and the code's
catalogue fields.
