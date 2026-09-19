//! B3 — border check of a reduced group: two `HashSet<u32>` per group replaced by two
//! sorted lists and a merge. Reference: old version, French names.
use super::harness::{compare, Bits, Row};
use super::inputs::Xorshift;
use crate::dag::border::border_survived;

fn reference_bordure(fusion: &[u32], reduit: &[u32], verrous: &[bool], soudure: &[u32]) -> bool {
    let exiges: std::collections::HashSet<u32> = fusion
        .iter()
        .filter(|&&id| verrous.get(id as usize).copied().unwrap_or(false))
        .map(|&id| soudure[id as usize])
        .collect();
    if exiges.is_empty() {
        return true;
    }
    let gardes: std::collections::HashSet<u32> =
        reduit.iter().map(|&id| soudure[id as usize]).collect();
    exiges.iter().all(|id| gardes.contains(id))
}

fn empreinte(garde: &bool) -> Bits {
    let mut bits = Bits::default();
    bits.flag(*garde);
    bits
}

pub(crate) fn row() -> Row {
    // Group of 32 clusters of 128 triangles, one in four vertices locked, dense weld.
    const SOMMETS: usize = 200_000;
    let mut rng = Xorshift::new(0xB0D3);
    let fusion: Vec<u32> = (0..32 * 128 * 3)
        .map(|_| rng.below(SOMMETS) as u32)
        .collect();
    let reduit: Vec<u32> = fusion.iter().rev().copied().collect();
    let verrous: Vec<bool> = (0..SOMMETS).map(|i| i % 4 == 0).collect();
    let soudure: Vec<u32> = (0..SOMMETS).map(|i| (i - i % 2) as u32).collect();
    compare(
        "B3 bord du groupe sans HashSet",
        "dag/border.rs",
        "groupe de 32 clusters, 12 288 coins, 200 000 sommets".into(),
        &mut || reference_bordure(&fusion, &reduit, &verrous, &soudure),
        &mut || border_survived(&fusion, &reduit, &verrous, &soudure),
        empreinte,
    )
}
