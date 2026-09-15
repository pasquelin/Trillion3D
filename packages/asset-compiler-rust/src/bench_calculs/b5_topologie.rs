//! B5 — `classify_link` : les trois `Vec` par sommet deviennent un bloc de travail réutilisé.
//! Référence : l'ancienne version, noms francisés.
use super::harness::{compare, Bits, Row};
use super::inputs::Xorshift;
use crate::topology::link::{classify_link, LinkScratch};

fn reference_classe(liens: &[(u32, u32)]) -> &'static str {
    let mut sommets: Vec<u32> = Vec::new();
    let mut voisins: Vec<[u32; 2]> = Vec::new();
    let mut degres: Vec<u8> = Vec::new();
    let case = |sommets: &mut Vec<u32>,
                voisins: &mut Vec<[u32; 2]>,
                degres: &mut Vec<u8>,
                sommet: u32|
     -> usize {
        match sommets.iter().position(|&id| id == sommet) {
            Some(index) => index,
            None => {
                sommets.push(sommet);
                voisins.push([u32::MAX; 2]);
                degres.push(0);
                sommets.len() - 1
            }
        }
    };
    for &(a, b) in liens {
        if a == b {
            continue;
        }
        for (de, vers) in [(a, b), (b, a)] {
            let index = case(&mut sommets, &mut voisins, &mut degres, de);
            let tenu = degres[index] as usize;
            if (tenu >= 1 && voisins[index][0] == vers) || (tenu >= 2 && voisins[index][1] == vers)
            {
                continue;
            }
            if tenu >= 2 {
                return "locked";
            }
            voisins[index][tenu] = vers;
            degres[index] = (tenu + 1) as u8;
        }
    }
    if sommets.is_empty() {
        return "locked";
    }
    let mut simples = 0;
    let mut doubles = 0;
    for &tenu in &degres {
        match tenu {
            1 => simples += 1,
            2 => doubles += 1,
            _ => return "locked",
        }
    }
    let mut vus = vec![false; sommets.len()];
    let mut composantes = 0;
    let mut pile = Vec::new();
    for depart in 0..sommets.len() {
        if vus[depart] {
            continue;
        }
        composantes += 1;
        if composantes > 1 {
            return "locked";
        }
        pile.push(depart);
        while let Some(noeud) = pile.pop() {
            if vus[noeud] {
                continue;
            }
            vus[noeud] = true;
            for &voisin in voisins[noeud].iter().take(degres[noeud] as usize) {
                if let Some(index) = sommets.iter().position(|&id| id == voisin) {
                    if !vus[index] {
                        pile.push(index);
                    }
                }
            }
        }
    }
    if simples == 0 && doubles == sommets.len() {
        "interior"
    } else if simples == 2 && doubles == sommets.len() - 2 {
        "boundary"
    } else {
        "locked"
    }
}

/// Liens de 60 000 sommets : éventails fermés, éventails ouverts et voisinages non variétés.
fn liens(seed: u64, count: usize) -> Vec<Vec<(u32, u32)>> {
    let mut rng = Xorshift::new(seed);
    (0..count)
        .map(|id| {
            let degre = 3 + rng.below(6);
            let base = (id * 8) as u32;
            match id % 3 {
                0 => (0..degre)
                    .map(|k| (base + k as u32, base + ((k + 1) % degre) as u32))
                    .collect(),
                1 => (0..degre - 1)
                    .map(|k| (base + k as u32, base + k as u32 + 1))
                    .collect(),
                _ => (0..degre)
                    .map(|_| (base + rng.below(8) as u32, base + rng.below(8) as u32))
                    .collect(),
            }
        })
        .collect()
}

fn empreinte(classes: &Vec<&'static str>) -> Bits {
    let mut bits = Bits::default();
    bits.len(classes.len());
    for classe in classes {
        bits.text(classe);
    }
    bits
}

pub(crate) fn row() -> Row {
    let jeux = liens(0x70_9010, 60_000);
    let mut reference = || jeux.iter().map(|lien| reference_classe(lien)).collect();
    let mut optimise = || {
        let mut bloc = LinkScratch::default();
        jeux.iter()
            .map(|lien| classify_link(lien, &mut bloc))
            .collect()
    };
    compare(
        "B5 classify_link à blocs réutilisés",
        "topology/link.rs",
        "60 000 sommets, degrés 3 à 8, éventails ouverts, fermés et non variétés".into(),
        &mut reference,
        &mut optimise,
        empreinte,
    )
}
