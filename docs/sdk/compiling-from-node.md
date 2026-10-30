# Compiling from Node

`prepare(input, output, scope, budget, options)`, `prepareMany(jobs, options)` and the
`trillion3d-compile` CLI relay to the native executable; arguments, events, batch mode,
cancellation, exit codes and how the executable is found:
[COMPILER.md](../compiler/using-it-from-node.md#using-it-from-node). Not found, it fails with
`COMPILER_EXECUTABLE_MISSING`, or `COMPILER_PLATFORM_UNSUPPORTED` on a machine the compiler is not
built for. Every error carries its public code, cause and action.
