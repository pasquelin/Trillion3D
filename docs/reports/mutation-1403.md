# #1403 — contracts mutation proof

Base: develop at 6214f6556e1a34198bf448e79b8f6b2a233f9649.

The issue's published reference was 59.3%. The local domain-only baseline was
55.63% (336/604); the final domain-only result is 99.34% (600/604).
These two baselines use different test scopes and must not be conflated.

The measurement used a local domain-scoped driver, described below. The standard
repository command reruns the same source scope with the full SDK test suite:

```sh
pnpm run test:mutation --mutate 'packages/sdk-core/src/contracts/**/*.ts' --mutate '!**/*.test.ts' --mutate '!**/*.fixture.ts'
```

The full-suite command may detect additional mutations; the reported score below
counts only kills supplied by contracts tests.

The driver uses Stryker's TAP runner, per-test coverage, two workers and every
contracts source file except tests and fixtures. It selects the domain's tests,
so it does not count kills contributed by other SDK domains. No additional
mutant exclusions or source suppression comments were added.

New tests exercise manifest identity and diagnostics, malformed cache data,
geometry error bands, impostor validation, error relaying, the SDK-node request
sheet consumer, and independently generated Rust proxy binary fixtures.

## Remaining mutants

The following are equivalent for ordinary contract data records, with stable
properties and the standard JavaScript built-ins. No denominator adjustment is
made: the reported score remains 99.34%, not 100%.

| ID  | File and original line | Equivalence reason                                                                                                             |
| --- | ---------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| 120 | cache.ts:102           | Removing the selectedTriangles typeof rejection still leaves Number.isFinite, which rejects every non-number without coercion. |
| 413 | geometry.ts:67         | Bypassing the lodError typeof check still leaves Number.isFinite, which only accepts finite numbers.                           |
| 339 | errorCodes.ts:65       | Sending null through JSON.stringify returns the same text, "null", as String(null).                                            |
| 352 | errorCodes.ts:82       | The documented code Set contains only primitive strings; Set.has rejects every non-string without coercion.                    |

These cover all surviving files, including the five-worst-files requirement.
Validation: `pnpm run check:changed` passed (2354 tests); `pnpm test` passed
(5158 tests, zero skipped).
