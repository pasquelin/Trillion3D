//! Benchmark output: Markdown table on console, same table and raw numbers in
//! `.mesure/out/calculs/`, outside repo.
use super::harness::Row;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Today's date YYYY-MM-DD, calculated from epoch without dependency.
pub(crate) fn today() -> String {
    let days = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0) as i64;
    // Howard Hinnant, civil_from_days: days since 1970-01-01 to year, month, day.
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let day = doy - (153 * mp + 2) / 5 + 1;
    let month = if mp < 10 { mp + 3 } else { mp - 9 };
    let year = era * 400 + yoe + i64::from(month <= 2);
    format!("{year:04}-{month:02}-{day:02}")
}

fn cell(value: Option<f64>) -> String {
    value.map_or_else(|| "null".into(), |v| format!("{v:.3}"))
}
fn oui_non(value: Option<bool>) -> String {
    value.map_or_else(|| "null".into(), |v| if v { "oui" } else { "non" }.into())
}

pub(crate) fn table(rows: &[Row]) -> String {
    let mut out = String::from(
        "| Computation | File | Before (ms) | After (ms) | Gain | Identical | Kept |\n\
         |---|---|---|---|---|---|---|\n",
    );
    for row in rows {
        let gain = row
            .gain()
            .map_or_else(|| "null".into(), |g| format!("{g:+.1} %"));
        let retenu = if !row.note.is_empty() {
            format!("non ({})", row.note)
        } else if row.retenu() {
            "oui".into()
        } else {
            "non".into()
        };
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} | {} | {} |\n",
            row.calcul,
            row.fichier,
            cell(row.avant),
            cell(row.apres),
            gain,
            oui_non(row.identique),
            retenu
        ));
    }
    out
}

fn shell(command: &str, args: &[&str]) -> Value {
    std::process::Command::new(command)
        .args(args)
        .output()
        .ok()
        .filter(|out| out.status.success())
        .map(|out| json!(String::from_utf8_lossy(&out.stdout).trim().to_string()))
        .unwrap_or(Value::Null)
}

pub(crate) fn mesures_dir() -> PathBuf {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.mesure/out/calculs")
        .components()
        .collect::<PathBuf>();
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Emits lines in JavaScript benchmark fragment format, in `.mesure/calculs-g`:
/// lot G table reads as single block, Rust and Node mixed, instead of two tables.
pub(crate) fn write_fragment_g(rows: &[Row]) {
    let dir = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../.mesure/calculs-g")
        .components()
        .collect::<PathBuf>();
    let _ = std::fs::create_dir_all(&dir);
    let entries: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({"calcul":row.calcul,"fichier":row.fichier,"taille":row.taille,
              "avantMs":row.avant,"apresMs":row.apres,"gain":row.gain().map(|g| g / 100.0),
              "identique":row.identique,"retenu":row.retenu(),"tours":row.tours,"note":row.note})
        })
        .collect();
    let _ = std::fs::write(
        dir.join("natif.json"),
        serde_json::to_vec_pretty(&entries).unwrap_or_default(),
    );
}

pub(crate) fn write(rows: &[Row]) {
    let date = today();
    let dir = mesures_dir();
    let entries: Vec<Value> = rows
        .iter()
        .map(|row| {
            json!({"calcul":row.calcul,"fichier":row.fichier,"taille":row.taille,
              "avantMs":row.avant,"apresMs":row.apres,"gainPct":row.gain(),
              "identique":row.identique,"tours":row.tours,"retenu":row.avant.is_some()&&row.retenu(),
              "note":row.note})
        })
        .collect();
    let json = json!({"date":date,"lot":"B+F","commit":shell("git",&["rev-parse","HEAD"]),
      "rustc":shell("rustc",&["--version"]),"profil":"release --locked",
      "toursMin":50,"budgetMs":2000,"machine":shell("uname",&["-mrs"]),"points":entries});
    let _ = std::fs::write(
        dir.join(format!("calculs-natif-{date}.json")),
        serde_json::to_vec_pretty(&json).unwrap_or_default(),
    );
    let text = |key: &str| json[key].as_str().unwrap_or("null").to_string();
    let mut page = format!(
        "# Native computations, lots B and F — {date}\n\nCommit {} · {} · release --locked · median over \
         at least 50 rounds or 2 s, both implementations alternating round by round.\n\n",
        text("commit"),
        text("rustc")
    );
    page.push_str(
        "A \"control\" line compares the bench copy to an unchanged library: its spread \
         gives the machine noise floor, which reaches ±20 % on short cases when \
         other jobs run alongside. Compilation of the golden fixtures and of a \
         500 000 triangle mesh, before and after, is in ",
    );
    page.push_str(&format!(
        "`calculs-natif-{date}-fixtures.json` (bytes compared one by one) and the `perf.rs` \
         per phase in `calculs-natif-{date}-phases.json`.\n\n"
    ));
    page.push_str(&table(rows));
    page.push('\n');
    let _ = std::fs::write(dir.join(format!("calculs-natif-{date}.md")), page);
}
