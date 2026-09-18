//! Le bord d'un groupe réduit : ce qui doit survivre à la simplification pour que deux groupes
//! voisins se rejoignent encore, et ce qu'on verrouille en plus quand ce n'est pas le cas.

/// Les triangles dont les trois coins diffèrent. Un triangle à deux coins confondus — deux copies
/// d'une même position, une fois soudées — n'a pas d'aire : meshoptimizer l'écarte, et un sommet
/// qui n'existait que là n'est pas un bord perdu (mesuré : 238 triangles sur 2 465 dans un groupe,
/// et les trois verrous « perdus » qui bloquaient sa reprise n'avaient aucun triangle vivant).
pub(super) fn live_triangles(indices: impl Iterator<Item = u32>) -> Vec<u32> {
    let mut out: Vec<u32> = indices.collect();
    let mut kept = 0usize;
    for tri in 0..out.len() / 3 {
        let (a, b, c) = (out[tri * 3], out[tri * 3 + 1], out[tri * 3 + 2]);
        if a != b && b != c && a != c {
            out.copy_within(tri * 3..tri * 3 + 3, kept);
            kept += 3;
        }
    }
    out.truncate(kept);
    out
}

/// Verrouille, soudés, les trois coins de tout triangle de `source` dont un coin est soudé à l'un
/// de `lost` ; `extra` reste trié et sans doublon pour la recherche binaire du verrou.
pub(super) fn lock_triangles_touching(
    source: &[u32],
    lost: &[u32],
    weld: &[u32],
    extra: &mut Vec<u32>,
) {
    for tri in source.as_chunks::<3>().0 {
        if tri
            .iter()
            .any(|&id| lost.binary_search(&weld[id as usize]).is_ok())
        {
            extra.extend(tri.iter().map(|&id| weld[id as usize]));
        }
    }
    extra.sort_unstable();
    extra.dedup();
}

/// Les sommets verrouillés de `merged`, soudés, triés, sans doublon : ceux que toute réduction du
/// groupe doit garder pour rejoindre encore ses voisins. Ne dépend pas de la réduction, donc calculé
/// une fois par groupe et non à chaque reprise.
pub(super) fn required_locks(merged: &[u32], locks: &[bool], weld: &[u32]) -> Vec<u32> {
    let mut required: Vec<u32> = merged
        .iter()
        .filter(|&&id| locks.get(id as usize).copied().unwrap_or(false))
        .map(|&id| weld[id as usize])
        .collect();
    required.sort_unstable();
    required.dedup();
    required
}

/// Ceux de `required` que `simplified` ne porte plus. Vide quand chaque sommet partagé avec un
/// autre groupe a survécu — sinon les deux groupes ne se rejoignent plus.
///
/// Deux listes triées et une fusion remplacent les deux `HashSet` d'avant : même question posée,
/// même réponse, sans hacher deux fois des dizaines de milliers de coins.
pub(super) fn lost_locks(required: &[u32], simplified: &[u32], weld: &[u32]) -> Vec<u32> {
    if required.is_empty() {
        return Vec::new();
    }
    let mut kept: Vec<u32> = simplified.iter().map(|&id| weld[id as usize]).collect();
    kept.sort_unstable();
    kept.dedup();
    let mut at = 0usize;
    required
        .iter()
        .copied()
        .filter(|&id| {
            while kept.get(at).is_some_and(|value| *value < id) {
                at += 1;
            }
            kept.get(at) != Some(&id)
        })
        .collect()
}

/// Every vertex shared with another group must survive, or the two groups no longer meet.
#[cfg(test)]
pub(crate) fn border_survived(
    merged: &[u32],
    simplified: &[u32],
    locks: &[bool],
    weld: &[u32],
) -> bool {
    lost_locks(&required_locks(merged, locks, weld), simplified, weld).is_empty()
}
