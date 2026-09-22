# Web Geometry Principles

Canonical source of architecture and product behavior requirements. These requirements serve as targets to validate: they do not claim all features are implemented today. See [SDK capabilities and limits](../packages/README.md).

1. **Portable Core.** Engine algorithms, formats, oracles, and contracts remain independent of React and Electron. The interface controls and observes campaigns; it contains no core engine logic.
2. **Compiled and Versioned Preparation.** Expensive assets are built outside the interactive loop, versioned alongside their schemas, and loaded following manifest validation. No hidden preparation overhead is charged to current frame rendering.
3. **Standalone Generators.** Any Rust asset preparation or compilation core resides in a standalone package in the Web Geometry repository under `packages/`. A benchmark contains only its manifests, contracts, scenarios, adapters, and tests, consuming the public package API. Engine and generator packages import neither React, Vite, Electron, nor benchmark internals.
4. **Never Degrade the Host Application.** The SDK negotiates capabilities and maintains a standard baseline. It disables an optimization when measured overhead exceeds benefit and recovers from error, device loss, memory exhaustion, or thrashing on the renderer already in use. A world's `renderer` option (absent = best path the machine grants) is chosen once, from what the machine offers; forced and missing, it is refused by name, never silently swapped for the other. The UI exposes the active renderer, active level, fallback, and reason without inventing metrics. WebGL fallback remains unproven until a dedicated physical test runs and passes.
5. **Seamless Fallback.** For the end user, fallback is automatic and silent: no technical warning appears during normal startup. Full diagnostic telemetry remains reserved for developer mode. A concise notification appears only when no compatible renderer is available. Recovering on the chosen renderer preserves scene state without flashing, blank screens, or visible restarts; it never switches to the other renderer under a host that did not ask for one.

## World API conventions

**API rule.** State read and written is a property; a value with several components is an object with `.set()`; a method is an action or a computation. A setter applies its own consequences. **Naming rule.** Families are singular; a member that produces a thing of the scene is named after the thing, one that sets up machinery is `create` + its name. Full contract: [docs/SDK.md](SDK.md#api-rule).

## Source Ownership and Integration

Web Geometry physically owns `asset-compiler-rust`, `page-codec`, `sdk-core`, `sdk-node`, and `sdk-browser` under `packages/`. The SDK exposes public entry points producing JavaScript and type declarations. React and Electron adapters remain optional and are not shipped as dedicated packages. Hosts consume public exports; design interfaces described in `docs/vision/` are not public APIs.

