//! Sortie du banc : le tableau Markdown sur la console, le même tableau et ses chiffres bruts dans
//! `orchestration/mesures/`.
use super::harness::Row;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::{SystemTime, UNIX_EPOCH};

/// Date du jour en AAAA-MM-JJ, calculée depuis l'époque sans dépendance.
pub(crate) fn today() -> String {
    let days = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() / 86_400)
        .unwrap_or(0) as i64;
    // Howard Hinnant, civil_from_days : jours depuis 1970-01-01 vers l'année, le mois, le jour.
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
        "| Calcul | Fichier | Avant (ms) | Après (ms) | Gain | Identique | Retenu |\n\
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
        .join("../../orchestration/mesures")
        .components()
        .collect::<PathBuf>();
    let _ = std::fs::create_dir_all(&dir);
    dir
}

/// Dépose les lignes au format des fragments du banc JavaScript, dans `.mesure/calculs-g` : le
/// tableau du lot G se lit d'un bloc, Rust et Node mêlés, au lieu de deux tableaux à rapprocher.
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
    let json = json!({"date":date,"lot":"B","commit":shell("git",&["rev-parse","HEAD"]),
      "rustc":shell("rustc",&["--version"]),"profil":"release --locked",
      "toursMin":50,"budgetMs":2000,"machine":shell("uname",&["-mrs"]),"points":entries});
    let _ = std::fs::write(
        dir.join(format!("calculs-natif-{date}.json")),
        serde_json::to_vec_pretty(&json).unwrap_or_default(),
    );
    let text = |key: &str| json[key].as_str().unwrap_or("null").to_string();
    let mut page = format!(
        "# Calculs natifs, lot B — {date}\n\nCommit {} · {} · release --locked · médiane sur au \
         moins 50 tours ou 2 s, les deux implémentations alternant tour par tour.\n\n",
        text("commit"),
        text("rustc")
    );
    page.push_str(
        "Une ligne « témoin » compare la copie du banc à une bibliothèque inchangée : son écart \
         donne le plancher de bruit de la machine, qui atteint ±20 % sur les cas courts quand \
         d'autres travaux tournent à côté. La compilation des fixtures dorées et d'un maillage de \
         500 000 triangles, avant et après, est dans ",
    );
    page.push_str(&format!(
        "`calculs-natif-{date}-fixtures.json` (octets comparés un à un) et les chronomètres de \
         `perf.rs` par phase dans `calculs-natif-{date}-phases.json`.\n\n"
    ));
    page.push_str(&table(rows));
    page.push('\n');
    let _ = std::fs::write(dir.join(format!("calculs-natif-{date}.md")), page);
}
