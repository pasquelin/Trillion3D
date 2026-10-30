# Using it from any other host

Spawn the executable, read stderr line by line and stdout once at exit, write a cancel line on stdin
when asked: the whole contract, the same on every platform. A Rust host can call
`trillion3d_compiler::compile(&Options, progress)` directly (`main.rs` is a thin layer over it); no
N-API or WebAssembly binding is provided.
