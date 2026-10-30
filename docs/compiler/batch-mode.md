# Batch mode

`--jobs FILE` (or `--jobs -`, read from stdin, which disables cancellation) runs many jobs in one
process, each with its own cache:

```json
{
  "workers": 2,
  "ramBudgetMb": 16384,
  "jobs": [
    {
      "id": "city",
      "source": "scenes/city/city.obj",
      "cache": "cache/city",
      "resourceBaseUrl": "/assets/city/"
    },
    {
      "id": "london",
      "source": "scenes/london",
      "cache": "cache/london",
      "resourceBaseUrl": "/assets/london/",
      "threads": 8
    }
  ]
}
```

| Field                                                                        | Meaning                                                                    | Default                                                       |
| ---------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ------------------------------------------------------------- |
| `workers`                                                                    | Concurrent jobs, at most 64, lowered until the budget holds them           | `1`                                                           |
| `ramBudgetMb`                                                                | Budget of the whole batch, split between workers unless a job sets its own | `4096 × workers`                                              |
| `threads`                                                                    | Default threads per job                                                    | auto (cores / workers)                                        |
| `jobs[].id`                                                                  | Unique job id in events and the summary                                    | `job-<index>`                                                 |
| `jobs[].source`, `cache`, `resourceBaseUrl`                                  | As on the command line                                                     | required                                                      |
| `jobs[].scope`, `triangleBudget`, `threads`, `ramBudgetMb`, `simplification` | Per-job overrides                                                          | `full`, `150000`, batch default, batch share, `qem-endpoints` |
| `jobs[].texturesFormat`                                                      | As `--textures-format=`                                                    | `bc7`                                                         |
| `jobs[].hlod`                                                                | As `--hlod=`, a JSON object                                                | none                                                          |
| `jobs[].temporalAntialiasing`                                                | As `--temporal-antialiasing=`, a level or a boolean                        | none                                                          |
| `jobs[].responsive`                                                          | As `--responsive=`, a string or a JSON object                              | none                                                          |
| `jobs[].materials`                                                           | As `--materials=`, a JSON object                                           | none                                                          |
| `jobs[].voxelize`                                                            | As `--voxelize=`, a string or a JSON object                                | none                                                          |
| `jobs[].partitionScheme`                                                     | As `--partition-scheme=`, a scheme's name or `true`                        | none                                                          |
| `jobs[].partitionGrid`                                                       | As `--partition-grid=`, a boolean or a JSON object                         | none                                                          |
| `jobs[].partitionGrids`                                                      | As `--partition-grids=`, a JSON list                                       | none                                                          |
| `jobs[].meshBuild`                                                           | As `--mesh-build=`, a JSON object                                          | none                                                          |
| `jobs[].objectSettings`                                                      | As `--object-settings=`, a JSON object                                     | none                                                          |
| `jobs[].lightmapBake`                                                        | As `--lightmap-bake=`, `true`, `false` or a JSON object                    | none                                                          |

Jobs go in file order to the first free worker. Two jobs writing one cache, under any spelling, or
a job asking for more than the whole budget, refuse the batch before it starts (`INVALID_BATCH`).
stdout then carries the summary, `{"status": "ready" | "partial" | "failed", "completed", "failed",
"cancelled", "jobs"}`, each job a pointer or an error, sorted by id; read it rather than the exit
code.
