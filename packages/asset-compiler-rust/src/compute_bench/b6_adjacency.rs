//! B6 — `cluster_adjacency` without a global sort: border edges are grouped by key
//! in a hash table. Weights are integer sums, so traversal order does not change
//! them. Reference: old version, French names.
use super::harness::{compare, Bits, Row};
use super::inputs;
use crate::dag::clusters::cluster_adjacency;
use std::collections::HashMap;

fn cle(a: u32, b: u32) -> u64 {
    let (bas, haut) = if a < b { (a, b) } else { (b, a) };
    ((bas as u64) << 32) | haut as u64
}

fn reference_adjacence(clusters: &[&[u32]]) -> Vec<Vec<(u32, u32)>> {
    let mut releves: Vec<(u64, u32)> = Vec::new();
    let mut locales: HashMap<u64, u32> = HashMap::new();
    for (identifiant, indices) in clusters.iter().enumerate() {
        locales.clear();
        for triangle in indices.as_chunks::<3>().0 {
            for k in 0..3 {
                *locales
                    .entry(cle(triangle[k], triangle[(k + 1) % 3]))
                    .or_insert(0) += 1;
            }
        }
        for (&clef, &compte) in locales.iter() {
            if compte == 1 {
                releves.push((clef, identifiant as u32));
            }
        }
    }
    releves.sort_unstable();
    let mut poids: Vec<HashMap<u32, u32>> = vec![HashMap::new(); clusters.len()];
    let mut debut = 0usize;
    while debut < releves.len() {
        let mut fin = debut + 1;
        while fin < releves.len() && releves[fin].0 == releves[debut].0 {
            fin += 1;
        }
        for i in debut..fin {
            for j in i + 1..fin {
                let (a, b) = (releves[i].1, releves[j].1);
                if a == b {
                    continue;
                }
                *poids[a as usize].entry(b).or_insert(0) += 1;
                *poids[b as usize].entry(a).or_insert(0) += 1;
            }
        }
        debut = fin;
    }
    poids
        .into_iter()
        .map(|table| {
            let mut liste: Vec<(u32, u32)> = table.into_iter().collect();
            liste.sort_unstable();
            liste
        })
        .collect()
}

fn empreinte(adjacence: &Vec<Vec<(u32, u32)>>) -> Bits {
    let mut bits = Bits::default();
    bits.len(adjacence.len());
    for liste in adjacence {
        bits.len(liste.len());
        for (voisin, poids) in liste {
            bits.u32(*voisin);
            bits.u32(*poids);
        }
    }
    bits
}

pub(crate) fn row() -> Row {
    let clusters = inputs::clusters(0x0AD_ACE, 2048, 128);
    let vues: Vec<&[u32]> = clusters.iter().map(Vec::as_slice).collect();
    compare(
        "B6 adjacency by border edges (control)",
        "dag/clusters.rs",
        "2 048 clusters de 128 triangles".into(),
        &mut || reference_adjacence(&vues),
        &mut || cluster_adjacency(&vues),
        empreinte,
    )
}
