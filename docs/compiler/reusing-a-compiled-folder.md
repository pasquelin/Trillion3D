# Reusing a compiled folder

When a folder already exists under the key, the compiler proves it whole with the compile path's
own checks — every product, object and baked texture level the manifest names — keeps it and skips
to the pointer (`compiler/cache/reuse.rs`). A failed check names its reason on the `reuse` event and the
job compiles again. A recompile of an unchanged source costs the hashing, not a build.
