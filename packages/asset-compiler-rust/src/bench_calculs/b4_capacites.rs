//! B4 — capacities reserved before the loops: region compaction, group index merge,
//! imported part index bytes. References: old versions, French names.
use super::harness::{compare, Bits, Row};
use super::inputs;
use crate::import::mesh::index_bytes;
use crate::qem::compact_region;

/// The pre-sized buffer is not visible at this size: the extracted function stays;
const NEUTRE: &str = "neutral capacity at this size (±0.3 %)";

type Compacte = (Vec<f32>, Vec<u32>, Vec<u32>);

fn reference_compacte(sommets: &[f32], indices: &[u32]) -> Compacte {
    let nombre = sommets.len() / 3;
    let mut positions = Vec::new();
    let mut retour = Vec::new();
    let mut locaux = Vec::with_capacity(indices.len());
    let pousse = |source: u32, positions: &mut Vec<f32>, retour: &mut Vec<u32>| {
        let debut = source as usize * 3;
        if debut + 2 < sommets.len() {
            positions.extend_from_slice(&sommets[debut..debut + 3]);
        } else {
            positions.extend_from_slice(&[0.0, 0.0, 0.0]);
        }
        retour.push(source);
    };
    if indices.len() * 4 >= nombre {
        let mut table = vec![u32::MAX; nombre];
        for &source in indices {
            let case = table.get_mut(source as usize);
            let identifiant = match case {
                Some(entree) if *entree != u32::MAX => *entree,
                Some(entree) => {
                    let identifiant = retour.len() as u32;
                    *entree = identifiant;
                    pousse(source, &mut positions, &mut retour);
                    identifiant
                }
                None => {
                    let identifiant = retour.len() as u32;
                    pousse(source, &mut positions, &mut retour);
                    identifiant
                }
            };
            locaux.push(identifiant);
        }
    } else {
        let mut carte = std::collections::HashMap::with_capacity(indices.len());
        for &source in indices {
            let identifiant = match carte.get(&source) {
                Some(&identifiant) => identifiant,
                None => {
                    let identifiant = retour.len() as u32;
                    carte.insert(source, identifiant);
                    pousse(source, &mut positions, &mut retour);
                    identifiant
                }
            };
            locaux.push(identifiant);
        }
    }
    (positions, locaux, retour)
}

fn empreinte_compacte(valeur: &Compacte) -> Bits {
    let mut bits = Bits::default();
    bits.len(valeur.0.len());
    for nombre in &valeur.0 {
        bits.f32(*nombre);
    }
    for liste in [&valeur.1, &valeur.2] {
        bits.len(liste.len());
        for entier in liste {
            bits.u32(*entier);
        }
    }
    bits
}

fn reference_octets(indices: &[u32], sommets: usize) -> (Vec<u8>, u32) {
    if sommets <= u16::MAX as usize {
        (
            indices
                .iter()
                .flat_map(|i| (*i as u16).to_le_bytes())
                .collect::<Vec<u8>>(),
            5123,
        )
    } else {
        (
            indices
                .iter()
                .flat_map(|i| i.to_le_bytes())
                .collect::<Vec<u8>>(),
            5125,
        )
    }
}

fn empreinte_octets(valeur: &(Vec<u8>, u32)) -> Bits {
    let mut bits = Bits::default();
    bits.bytes(&valeur.0);
    bits.u32(valeur.1);
    bits
}

pub(crate) fn rows() -> Vec<Row> {
    let (positions, indices) = inputs::mesh(0xCA_9AC1, 200_000);
    let region = &indices[..64 * 1024];
    // Deux parties : juste sous la limite u16 et juste au-dessus, pour couvrir les deux encodages.
    let courts: Vec<u32> = (0..600_000u32).map(|i| i % 65_535).collect();
    let longs: Vec<u32> = (0..600_000u32).map(|i| i % 65_536).collect();
    vec![
        compare(
            "B4 region compaction",
            "qem.rs",
            "65 536 corners, 100 000 vertices, duplicates and degenerates".into(),
            &mut || reference_compacte(&positions, region),
            &mut || compact_region(&positions, region),
            empreinte_compacte,
        ),
        compare(
            "B4 octets d'indices (u16)",
            "import/mesh.rs",
            "600 000 indices, 65 535 sommets".into(),
            &mut || reference_octets(&courts, 65_535),
            &mut || index_bytes(&courts, 65_535),
            empreinte_octets,
        )
        .ecarte(NEUTRE),
        compare(
            "B4 octets d'indices (u32)",
            "import/mesh.rs",
            "600 000 indices, 65 536 sommets".into(),
            &mut || reference_octets(&longs, 65_536),
            &mut || index_bytes(&longs, 65_536),
            empreinte_octets,
        )
        .ecarte(NEUTRE),
    ]
}
