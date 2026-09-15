//! B1 — `world_matrices` calculé une fois et partagé, au lieu d'une fois par consommateur.
//! Référence : les deux appels que `coplanar/pairs.rs` et `coplanar/surface.rs` faisaient chacun.
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
        let pour_pairs = world_matrices(&g).expect("monde des paires");
        let pour_surfaces = world_matrices(&g).expect("monde des surfaces");
        (pour_pairs, pour_surfaces)
    };
    // Le partage réel ne copie rien ; le clone rend la mesure conservatrice.
    let mut optimise = || {
        let partage = world_matrices(&g).expect("monde partagé");
        (partage.clone(), partage)
    };
    compare(
        "B1 matrices monde partagées",
        "compiler_world.rs, coplanar/pairs.rs, coplanar/surface.rs",
        "20 000 nœuds, chaînes de 32 niveaux, matrices non uniformes et miroirs".into(),
        &mut reference,
        &mut optimise,
        empreinte,
    )
}
