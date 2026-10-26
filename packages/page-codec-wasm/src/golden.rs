//! The reference values of the codec's mirrored primitives (`trillion3d_math::golden`): the
//! octahedral normal (`oct.rs`) with its inverse and the culling hierarchy (`culling.rs`).

use trillion3d_math::golden::run;

mod culling;
mod oct;

#[test]
fn golden_twins() {
    let twins = oct::twins().into_iter().chain(culling::twins());
    run(&twins.collect::<Vec<_>>());
}
