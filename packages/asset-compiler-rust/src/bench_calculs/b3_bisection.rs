//! B3 — `refine_bisection` : la table `present` devient un `Vec<bool>` réutilisé au lieu d'un
//! `HashSet<usize>` reconstruit à chaque coupe. Référence : l'ancienne version, noms francisés.
use super::harness::{compare, Bits, Row};
use super::inputs::Xorshift;
use crate::dag::groups::refine_bisection;

fn reference_affiner(
    tranche: &[usize],
    cote: &mut [u8],
    voisinage: &[Vec<(u32, u32)>],
    plancher: usize,
) {
    let mut presents: std::collections::HashSet<usize> =
        std::collections::HashSet::with_capacity(tranche.len());
    for &membre in tranche.iter() {
        presents.insert(membre);
    }
    let mut effectifs = [0usize; 2];
    for &membre in tranche.iter() {
        effectifs[cote[membre] as usize] += 1;
    }
    for _ in 0..2 {
        let mut bouge = false;
        for &membre in tranche.iter() {
            let ici = cote[membre] as usize;
            if effectifs[ici] <= plancher {
                continue;
            }
            let mut interne = 0i64;
            let mut externe = 0i64;
            for &(autre, poids) in voisinage.get(membre).map(|v| v.as_slice()).unwrap_or(&[]) {
                if !presents.contains(&(autre as usize)) {
                    continue;
                }
                if cote[autre as usize] as usize == ici {
                    interne += poids as i64;
                } else {
                    externe += poids as i64;
                }
            }
            if externe > interne {
                cote[membre] = 1 - cote[membre];
                effectifs[ici] -= 1;
                effectifs[1 - ici] += 1;
                bouge = true;
            }
        }
        if !bouge {
            break;
        }
    }
}

/// Voisinage synthétique : chaque cluster touche jusqu'à huit voisins proches, poids 1 à 4.
fn voisinage(seed: u64, count: usize) -> Vec<Vec<(u32, u32)>> {
    let mut rng = Xorshift::new(seed);
    (0..count)
        .map(|id| {
            (0..8)
                .map(|_| {
                    let voisin = (id + 1 + rng.below(64)) % count;
                    (voisin as u32, 1 + (rng.below(4) as u32))
                })
                .collect()
        })
        .collect()
}

// Le type mesuré est un `Vec<u8>` : l'empreinte doit avoir la signature que `compare` attend.
#[allow(clippy::ptr_arg)]
fn empreinte(cote: &Vec<u8>) -> Bits {
    let mut bits = Bits::default();
    bits.bytes(cote);
    bits
}

pub(crate) fn row() -> Row {
    const COUNT: usize = 8192;
    let adjacency = voisinage(0xB13EC, COUNT);
    let membres: Vec<usize> = (0..COUNT).collect();
    let depart: Vec<u8> = (0..COUNT).map(|i| u8::from(i >= COUNT / 2)).collect();
    let plancher = COUNT * 3 / 8;
    let mut reference = || {
        let mut cote = depart.clone();
        reference_affiner(&membres, &mut cote, &adjacency, plancher);
        cote
    };
    let mut optimise = || {
        let mut cote = depart.clone();
        let mut presents = vec![false; COUNT];
        refine_bisection(&membres, &mut cote, &adjacency, plancher, &mut presents);
        cote
    };
    compare(
        "B3 refine_bisection sans HashSet",
        "dag/groups.rs",
        "8 192 clusters, 8 voisins chacun".into(),
        &mut reference,
        &mut optimise,
        empreinte,
    )
}
