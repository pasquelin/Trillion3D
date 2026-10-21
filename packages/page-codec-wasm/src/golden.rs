//! The reference values of the codec's mirrored primitives (`trillion3d_math::golden`): the
//! octahedral normal (`oct.rs`) with its inverse, the culling hierarchy (`culling.rs`) and the
//! proxy BVH's child boxes (`proxy/wide/tests.rs`).

use trillion3d_math::golden::run;

mod culling;
mod oct;

#[test]
fn golden_twins() {
    let twins = oct::twins()
        .into_iter()
        .chain(culling::twins())
        .chain([crate::proxy::wide::tests::twin()]);
    run(&twins.collect::<Vec<_>>());
}
