//! B1 — `world_matrices` computed once and shared, instead of once per consumer.
//! Reference: the two calls `coplanar/pairs.rs` and `coplanar/surface.rs` each made.
use super::harness::{compare, Bits, Row};
use super::inputs;
use crate::compiler_world::{world_matrices, Mat4};

type Paire = (Vec<Mat4>, Vec<Mat4>);

fn empreinte(paire: &Paire) -> Bits {
    let mut bits = Bits::default();
    for monde in [&paire.0, &paire.1] {
        bits.len(monde.len());
        for matrice in monde {
            for value in matrice {
                bits.f64(*value);
            }
        }
    }
    bits
}

pub(crate) fn row() -> Row {
    let g = inputs::scene(0x51ED_0B01, 20_000, 32);
    let mut reference = || {
        let pour_pairs = world_matrices(&g).expect("pairs world");
        let pour_surfaces = world_matrices(&g).expect("surfaces world");
        (pour_pairs, pour_surfaces)
    };
    // Real sharing copies nothing; the clone makes the measurement conservative.
    let mut optimise = || {
        let partage = world_matrices(&g).expect("shared world");
        (partage.clone(), partage)
    };
    compare(
        "B1 shared world matrices",
        "compiler_world.rs, coplanar/pairs.rs, coplanar/surface.rs",
        "20 000 nodes, 32-level chains, non-uniform matrices and mirrors".into(),
        &mut reference,
        &mut optimise,
        empreinte,
    )
}
