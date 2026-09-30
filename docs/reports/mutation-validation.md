# SDK-core mutation validation

Validation recorded on 2026-09-30 for the mutation work based on develop
`6214f6556e1a34198bf448e79b8f6b2a233f9649`.

- `pnpm run check:changed` passed, including 2631 related tests and no skips.
- `pnpm test` passed: 5303 tests, zero failures, zero skips.
- After the full-suite run, the complete current runtime, physics and bounce
  test folders passed together: 162 tests, zero failures, zero skips.
- The tools TypeScript project passed after correcting the collision fixture's
  material type. All published test files passed formatting and the 200-line limit.

The complete-suite command collects test paths when it starts. Tests added later
are covered by the final domain runs above. Further world, collision and lighting
work is still in progress and is not declared complete by this report.

| Issue | Domain  | Published implementation | Mutation result   |
| ----- | ------- | ------------------------ | ----------------- |
| #1395 | runtime | `3a5f9e961a`             | 628/649, 96.76%   |
| #1399 | physics | `ecef3228fd`             | 1329/1346, 98.74% |
| #1400 | bounce  | `fe7c3c7ca2`             | 414/431, 96.06%   |

Each implementation commit includes the before/after evidence and individual
survivor explanations in its message. The runtime follow-up supersedes the earlier
runtime survivor analysis, after independent review identified additional supported
inputs and a cleanup defect. All three final measurements retained their equivalent
survivors in the score denominator; no new mutation exclusions were introduced.

For runtime, a failing assertion containing an object with a throwing getter
exposed a Node TAP reporter failure. Replacing deep object inspection with separate
length and reference assertions preserved the behavioral check. The final ordinary
Stryker run then reported zero runtime or compile errors; no result statuses were
manually manufactured.

Local logs are in `.worktrees/logs/check-changed-agents.log`,
`.worktrees/logs/test-unit-agents.log`,
`.worktrees/logs/release-1395-1399-1400.log`, and
`.worktrees/logs/collision-types.log`. Raw mutation reports remain under
`.mesure/out/<issue>-after/` while the remaining work is being integrated.
