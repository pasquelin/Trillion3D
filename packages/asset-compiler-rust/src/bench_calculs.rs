//! Comparison bench of the native compiler's computations (lot B).
//!
//! For each optimised point, the bench keeps a copy of the previous implementation
//! (`reference_…`, French names) and runs it on exactly the same inputs as the
//! library. It first compares both results bit for bit, then measures the median
//! of each. Launch: `pnpm run bench:calculs:natif`.
mod b1_monde;
mod b2_manifeste;
mod b3_bisection;
mod b3_bordure;
mod b4_capacites;
mod b5_page;
mod b5_topologie;
mod b6_adjacence;
mod b9_vecteurs;
mod f_boites;
mod f_scalaires;
mod f_valeurs;
mod fixture;
mod g10_preview;
mod g12_statistiques;
mod g7_etiquettes;
mod g9_accessor;
mod h3_proxy;
mod harness;
pub(crate) mod inputs;
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
    // The hash table was measured at 52.0 ms against 28.8 ms for the global sort: dropped.
    // The row therefore compares the bench copy to an unchanged library and is the control.
    rows.push(b6_adjacence::row().ecarte(
        "hash table measured at 52.0 ms against 28.8 ms for the global sort, without SmallVec \
         which the Cargo.lock lock forbids: change dropped, the row is the bench control",
    ));
    rows.push(Row::note(
        "B7 reused SHA-256 digests",
        "compiler_primitive*.rs",
        "deferred: the only recomputation is re-reading an object already in cache, which \
         validates the persisted entry",
    ));
    rows.push(Row::note(
        "B8 CornerHasher by 32-bit words",
        "import.rs",
        "already done: write_u32 is already redefined",
    ));
    rows.push(b9_vecteurs::row().ecarte(
        "the gap between the bench copy and the library changes sign from one run to \
         another: no gain to prove, the attributes were not applied",
    ));
    rows.push(h3_proxy::row());
    rows.extend(formules());
    rows
}

/// Lot F — equivalence of the formulas factored into `shared_math.rs`. These rows
/// do not seek a gain: they prove that the one remaining copy yields the same bits
/// as each copy it replaces, hostile values included. A "no" row means rollback.
fn formules() -> Vec<Row> {
    let mut rows = vec![
        f_boites::row_points(),
        f_boites::row_boites(),
        f_boites::row_simple(),
        f_boites::row_bisection(),
        f_scalaires::row_bourrage(),
        f_scalaires::row_normalisation(),
    ];
    for row in &mut rows {
        if row.note.is_empty() {
            row.note = "factorisation to identical result: no gain expected".into();
        }
    }
    rows.push(Row::note(
        "F7 secondes vers millisecondes (elapsed_ms)",
        "shared_math.rs",
        "off-bench: the input is a measured duration, never twice the same; the formula is the \
         compiler's only `as_secs_f64() * 1000.0`, moved unchanged",
    ));
    rows
}

/// Lot G points carried by the native compiler. Their rows are written in the
/// JavaScript bench fragment format: `scripts/mesure/calculs/agrege-g.ts` assembles
/// the twelve points of the lot into one table, without distinguishing what comes
/// from Rust from what comes from Node.
#[test]
#[ignore]
fn bench_calculs_g() {
    let measured = vec![
        g7_etiquettes::row(),
        g9_accessor::row(),
        g10_preview::row(),
        g12_statistiques::row(),
    ];
    let table = rapport::table(&measured);
    rapport::write_fragment_g(&measured);
    println!("\n{table}");
    let ecarts: Vec<&str> = measured
        .iter()
        .filter(|row| row.identique == Some(false))
        .map(|row| row.calcul.as_str())
        .collect();
    assert!(ecarts.is_empty(), "different results: {ecarts:?}");
}

#[test]
#[ignore]
fn bench_calculs() {
    let measured = rows();
    let table = rapport::table(&measured);
    rapport::write(&measured);
    let (total, path) = fixture::run();
    println!("\n{table}");
    println!("Golden fixtures: {total:.1} ms in total, survey in {path}\n");
    let ecarts: Vec<&str> = measured
        .iter()
        .filter(|row| row.identique == Some(false))
        .map(|row| row.calcul.as_str())
        .collect();
    assert!(ecarts.is_empty(), "different results: {ecarts:?}");
}
