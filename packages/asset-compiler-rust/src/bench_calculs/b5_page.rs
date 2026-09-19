//! B5 — local renumbering of a geometry page: table and lists sized in advance.
//! Reference: old version, French names.
use super::harness::{compare, Bits, Row};
use super::inputs;
use crate::geometry_page::localise;

type Locale = (Vec<u32>, Vec<u32>);

fn reference_localise(indices: &[u32], sommets: usize) -> Locale {
    let mut sources = Vec::<u32>::new();
    let mut table = std::collections::HashMap::<u32, u32>::new();
    let mut locaux = Vec::<u32>::with_capacity(indices.len());
    for &source in indices {
        assert!((source as usize) < sommets, "index outside positions");
        let identifiant = if let Some(&identifiant) = table.get(&source) {
            identifiant
        } else {
            let identifiant = sources.len();
            assert!(identifiant < 65535, "vertex limit");
            sources.push(source);
            table.insert(source, identifiant as u32);
            identifiant as u32
        };
        locaux.push(identifiant);
    }
    (sources, locaux)
}

fn empreinte(valeur: &Locale) -> Bits {
    let mut bits = Bits::default();
    for liste in [&valeur.0, &valeur.1] {
        bits.len(liste.len());
        for entier in liste {
            bits.u32(*entier);
        }
    }
    bits
}

pub(crate) fn row() -> Row {
    // 128 triangles per page, 20,000 pages: volume of an entire primitive.
    let (positions, indices) = inputs::mesh(0x9A_9E5, 128 * 20_000);
    let sommets = positions.len() / 3;
    let pages: Vec<&[u32]> = indices.chunks(128 * 3).collect();
    compare(
        "B5 page renumbering",
        "geometry_page.rs",
        "20 000 pages of 128 triangles".into(),
        // `fold` forces a pass over every page; only the last is used as fingerprint.
        &mut || {
            pages
                .iter()
                .fold(None, |_, page| Some(reference_localise(page, sommets)))
                .expect("pages")
        },
        &mut || {
            pages
                .iter()
                .fold(None, |_, page| Some(localise(page, sommets).expect("page")))
                .expect("pages")
        },
        empreinte,
    )
}
