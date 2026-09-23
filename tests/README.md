# Cross-cutting Tests

Everything that is not a unit test lives here; a unit test sits next to the file it tests, under
`packages/*/src/`.

- **`integration/`** — architecture and contract tests: package boundaries, engine without the host
  library, the public facade and the installed package. Run by `pnpm test`.
- **`browser/renders/`** — rendering proofs executed in real Chromium (WebGPU / WebGL2), one
  `*.browser.ts` each: all launched, none excluded (`BROWSER_ECARTES`, `browser/test-gpu.ts`).
- **`browser/probes/`** — hardware precision probes. A probe is a file whose name contains a hyphen;
  the other files are its support modules, never run alone.
- **`browser/support/`** — the pages, scenes and cases the render proofs serve to the browser.
- **`kit/`** — the shared test tools: fake GPU devices (`gpu/`), the static server and the fixture
  route (`server/`), the bit-exact comparison and the hostile-value list (`assert/`).
- **`fixtures/`** — test data builders; `formats/` holds the golden inputs and expected outputs of the
  native compiler, read by its Rust tests.

`browser/renders/` and `browser/probes/` run together via `pnpm run test:gpu`
(`browser/test-gpu.ts`), and `browser/test-gpu.test.ts` keeps **launched ∪ skipped == disk** in both:
no file can silently stop running. The local corpus of source formats stays off git.

Full documentation, with the counts of each folder: [`docs/TESTS.md`](../docs/TESTS.md).
