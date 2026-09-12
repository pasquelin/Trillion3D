# Portable engine contribution rules

These rules supplement repository-wide instructions; they do not replace them.

- Keep React, Electron, Vite, DOM and platform filesystem APIs out of runtime-core and shared contracts. Put browser and filesystem concerns in their named adapters.
- Consume public entry points. Do not import application internals from a package.
- Keep formatVersion separate from compilerVersion. Reject unknown formats; never silently interpret incompatible cached data.
- Any change to the compiler or cache identity needs correctness fixtures and source/strategy provenance. Never overwrite source assets.
- Record a before/after baseline on the same input, camera, quality, machine and resource budget. Unknown metrics are null, not estimates labeled as measured.
- Keep diagnostics outside measured beauty passes. Report unsupported capabilities explicitly.
- Target constrained machines too. Bound worker counts and allocation; distinguish admission estimates from enforced RSS limits.
- New pipeline stages need versioned contracts, cancellation, observable work and failure semantics. Do not bury algorithms in the CLI or UI.
- All generic Rust library/CLI code belongs under packages/, never inside a numbered benchmark. `test/engineStructure.test.mjs` enforces the core/adapters import restrictions in the normal test suite; `npm run check:structure` also type-checks sdk-core without DOM libraries.
