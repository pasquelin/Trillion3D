//! The reference values of the codec's mirrored primitives (`trillion3d_math::golden`): the
//! octahedral normal (`oct.rs`) and the quantization (`quant.rs`) each with its inverse, a primitive's grids
//! (`grid.rs`) and the culling hierarchy (`culling.rs`).

use trillion3d_math::golden::run;

mod culling;
pub(crate) mod grid;
mod oct;
mod quant;

#[test]
fn golden_twins() {
    let twins = oct::twins()
        .into_iter()
        .chain(culling::twins())
        .chain(quant::twins())
        .chain(grid::twins());
    run(&twins.collect::<Vec<_>>());
}
