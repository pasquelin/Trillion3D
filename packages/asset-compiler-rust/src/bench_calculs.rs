//! Banc de comparaison des calculs du compilateur natif (lot B).
//!
//! Pour chaque point optimisé, le banc garde une copie de l'implémentation d'avant (`reference_…`,
//! aux noms francisés) et la fait tourner sur exactement les mêmes entrées que celle de la
//! bibliothèque. Il compare d'abord les deux résultats bit à bit, puis mesure la médiane de chacune.
//! Lancement : `npm run bench:calculs:natif`.
mod b1_monde;
mod b2_manifeste;
mod b3_bisection;
mod b3_bordure;
mod b4_capacites;
mod b5_page;
mod b5_topologie;
mod b6_adjacence;
mod b9_vecteurs;
mod fixture;
mod g7_etiquettes;
mod g9_accessor;
mod harness;
mod inputs;
mod rapport;

use harness::Row;

fn rows() -> Vec<Row> {
    let mut rows = vec![
        b1_monde::row(),
        b2_manifeste::row(),
        b3_bisection::row(),
        b3_bordure::row(),
    ];
    rows.extend(b4_capacites::rows());
    rows.push(b5_topologie::row());
    rows.push(b5_page::row());
    // La table de hachage a été mesurée à 52,0 ms contre 28,8 ms pour le tri global : écartée.
    // La ligne compare donc la copie du banc à une bibliothèque inchangée et sert de témoin.
    rows.push(b6_adjacence::row().ecarte(
        "table de hachage mesurée à 52,0 ms contre 28,8 ms pour le tri global, sans SmallVec que \
         le verrou de Cargo.lock interdit : changement écarté, la ligne est le témoin du banc",
    ));
    rows.push(Row::note(
        "B7 digests SHA-256 réutilisés",
        "compiler_primitive*.rs",
        "reporté : le seul recalcul est la relecture d'un objet déjà en cache, qui valide \
         l'entrée persistée",
    ));
    rows.push(Row::note(
        "B8 CornerHasher par mots de 32 bits",
        "import.rs",
        "déjà fait : write_u32 est déjà redéfini",
    ));
    rows.push(b9_vecteurs::row().ecarte(
        "l'écart entre la copie du banc et la bibliothèque change de signe d'une exécution à \
         l'autre : aucun gain à prouver, les attributs n'ont pas été posés",
    ));
    rows
}

/// Les points du lot G portés par le compilateur natif. Leurs lignes sont déposées au format des
/// fragments du banc JavaScript : `scripts/mesure/calculs/agrege-g.mjs` assemble les douze points
/// du lot en un seul tableau, sans distinguer ce qui vient de Rust de ce qui vient de Node.
#[test]
#[ignore]
fn bench_calculs_g() {
    let measured = vec![g7_etiquettes::row(), g9_accessor::row()];
    let table = rapport::table(&measured);
    rapport::write_fragment_g(&measured);
    println!("\n{table}");
    let ecarts: Vec<&str> = measured
        .iter()
        .filter(|row| row.identique == Some(false))
        .map(|row| row.calcul.as_str())
        .collect();
    assert!(ecarts.is_empty(), "résultats différents : {ecarts:?}");
}

#[test]
#[ignore]
fn bench_calculs() {
    let measured = rows();
    let table = rapport::table(&measured);
    rapport::write(&measured);
    let (total, path) = fixture::run();
    println!("\n{table}");
    println!("Fixtures dorées : {total:.1} ms au total, relevé dans {path}\n");
    let ecarts: Vec<&str> = measured
        .iter()
        .filter(|row| row.identique == Some(false))
        .map(|row| row.calcul.as_str())
        .collect();
    assert!(ecarts.is_empty(), "résultats différents : {ecarts:?}");
}
