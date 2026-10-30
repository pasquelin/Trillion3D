# Exit codes and error codes

| Program | Code | Meaning |
| --- | --- | --- |
| `trillion3d-compiler` | 0 | Every job ready |
| `trillion3d-compiler` | 2 | Usage error, invalid batch, or a job failed or cancelled; stdout carries the error or the summary |
| `trillion3d-compile` | 1 | Any failure |
| `trillion3d-compile` | 3 | `--strict` and a warning (`STRICT_WARNINGS`); the cache is written |

Every code, of the compiler, its drivers and the Node adapter, has a stable public code, one sentence,
its cause and its action, printed with the message from the catalogue
`packages/sdk-node/src/messages/messages.json`. An error publishes nothing; a warning is always told and
never stops a compile that can succeed; an info is told on request. A refusal inside a primitive starts
with `Mesh <m> primitive <p>: `.

When something fails, read the printed `cause` and `action`: they are the documentation, and no other
page lists the codes. The `unsupported` counts of the pointer name what a driver could not carry from the
source.
