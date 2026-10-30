# Events

stderr carries one JSON event per line, stdout the pointer or batch summary at the end, stdin
optional cancel lines; the manifest is never printed. Every event is `{"event", "job", ...}`, `job`
being `"job"` for a single invocation and `"*"` on batch lines. `accepted`, `progress` and
`complete` carry `ratio`, a whole-job estimate from 0 to 1 that never goes backwards
(`build/progress.rs`), and `peakRssBytes`, the process's peak memory so far.

| Event | When | Fields |
| --- | --- | --- |
| `batch` | First line of `--jobs` | `jobs`, `workers` |
| `queued` | Each batch job, before any work | `source` |
| `accepted` | A worker starts the job | `source`, `cache`, `scope`, `triangleBudget`, `threads`, `ramBudgetMb`, `simplification` |
| `progress` `import-source` | A converting driver writes its scene | `step` (`parse`, `meshes`, `write`, `complete`, `reused`), `completed`, `total` |
| `progress` `archive` | A container is extracted, then routed | `step` (`extract`, `routed`), `entries`, `bytes`, `chain` |
| `progress` `import` | Scene loaded and validated | `primitives`, `nodes`, `unsupported` (counts by code), `ms` |
| `progress` `primitive` | One primitive clustered and paged, in no fixed order | `mesh`, `primitive`, `pages`, `timings`, `warnings` |
| `progress` `bootstrap` | Root bundles assembled | `completed`, `total` |
| `progress` `coplanar` | Coplanar cuts | `step`, `completed`, `total` |
| `progress` `textures` | One source image baked | `completed`, `total` |
| `progress` `tables` | Prepared scene tables written | `counts`, `ms` |
| `progress` `lights` | `lights.json` written | `lights`, `rejected`, `counts` |
| `progress` `reuse` | A folder under the key kept (`completed: 1`) or refused (`reason`) | `completed`, `files`, `objects`, `textureLevels`, `validateMs`, `reason` |
| `progress` `prune` | Stale keys, imports, objects or texture levels removed | `removedKeys`, `removedObjects`, `removedBytes`, `removedTextures` |
| `progress` `complete` | Pointer written | `pruned` |
| `stall` | Success with stalled DAG groups, before `complete` | `rank`, `mesh`, `primitive`, `rootTriangles`, `cause`, `seamVertices`, `lockedVertices`, `uvIslands` |
| `complete` | The job succeeded | `pointer` (as on stdout), `ms` |
| `cancelled` | The job stopped on a cancel request | `code: "CANCELLED"`, `message`, `ms`, catalogue fields |
| `error` | The job failed | `code`, `message`, `ms`, catalogue fields |
| `done` | Last line of `--jobs` | `completed`, `failed`, `cancelled`, `ms` |

A code the message catalogue knows leaves with its catalogue fields: `id`, the stable public code
(`T3D-Exxx` error, `T3D-Wxxx` warning, `T3D-Ixxx` info), `level`, `cause` and `action`; so do a
`primitive` event's `warnings`. `code` stays the symbolic name the cache writes.
