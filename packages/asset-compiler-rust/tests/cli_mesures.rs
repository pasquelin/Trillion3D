//! V02 : les mesures finales d'un travail traversent la frontière du programme. Le manifeste est
//! écrit avant la purge du cache : lui seul ne peut pas les porter, et l'hôte qui ne lit que le
//! pointeur doit donc les y trouver — sans quoi la purge n'est mesurée nulle part.
mod common;
use common::{compiler, fixture, lines};
use serde_json::Value;
use std::{fs, process::Stdio};

/// Les millisecondes d'une mesure du pointeur, refusées si elles manquent ou ne sont pas un nombre.
fn measure(pointer: &Value, name: &str) -> f64 {
    pointer["metrics"][name]
        .as_f64()
        .unwrap_or_else(|| panic!("mesure {name} absente du pointeur {}", pointer["metrics"]))
}

#[test]
fn v02_le_pointeur_porte_les_mesures_prises_apres_le_manifeste() {
    let (root, obj, cache) = fixture("mesures");
    let output = compiler(&obj, &cache)
        .stdin(Stdio::null())
        .output()
        .expect("run");
    assert!(
        output.status.success(),
        "stderr: {}",
        String::from_utf8_lossy(&output.stderr)
    );
    let stdout = lines(&String::from_utf8_lossy(&output.stdout));
    let pointer = &stdout[0];
    let (wall, prune) = (measure(pointer, "wallMs"), measure(pointer, "pruneMs"));
    assert!(
        wall >= prune,
        "durée totale {wall} ms sous la purge {prune} ms"
    );
    // L'évènement `complete` porte ce même pointeur : un hôte qui suit le flux en sait autant.
    let events = lines(&String::from_utf8_lossy(&output.stderr));
    let complete = events
        .iter()
        .rfind(|event| event["event"] == "complete")
        .expect("évènement complete");
    assert_eq!(complete["pointer"]["metrics"], pointer["metrics"]);
    fs::remove_dir_all(root).ok();
}
