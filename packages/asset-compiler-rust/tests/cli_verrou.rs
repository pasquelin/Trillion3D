//! A18 et A19 : le verrou d'un cache, vu de l'extérieur, par processus. Ce que ces épreuves
//! tiennent : un verrou que plus personne ne détient ne bloque rien, un propriétaire vivant fait
//! renoncer le second dans le délai annoncé.
mod common;
use common::{compiler, fixture, grid_fixture, lines};
use serde_json::Value;
use std::{
    fs::{self, File},
    path::{Path, PathBuf},
    process::{Output, Stdio},
    time::{Duration, Instant},
};

/// Le chemin du verrou sous le cache : un contrat, puisqu'un hôte peut le voir paraître.
fn lock_path(cache: &Path) -> PathBuf {
    cache.join("native").join(".lock")
}
/// Le verrou pris comme le prend une compilation vivante : le fichier créé s'il manque, jamais
/// tronqué, puis la prise du système. Le tenir depuis l'épreuve elle-même, et non depuis un
/// processus qui compile, rend l'épreuve indépendante de toute durée.
fn hold(cache: &Path) -> File {
    fs::create_dir_all(cache.join("native")).expect("native");
    let file = fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path(cache))
        .expect("ouverture du verrou");
    file.try_lock()
        .expect("le verrou est libre avant l'épreuve");
    file
}
/// L'unique ligne que le programme écrit sur sa sortie : le pointeur, ou le refus.
fn outcome(output: &Output) -> Value {
    let printed = lines(&String::from_utf8_lossy(&output.stdout));
    assert_eq!(printed.len(), 1, "une seule ligne de sortie");
    printed[0].clone()
}
/// Attend que le fichier de verrou paraisse, donc que la compilation soit entrée dans le cache.
fn wait_for(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(60);
    while !path.exists() {
        assert!(Instant::now() < deadline, "le verrou n'est jamais apparu");
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// A18 : le propriétaire du verrou est tué net en pleine compilation. Personne ne détient plus rien,
/// et le système l'a acté à la mort du processus : la relance doit prendre le verrou du premier
/// coup. Attente nulle, donc l'épreuve ne mesure aucune durée : elle réussit, ou elle est refusée.
#[test]
fn a18_le_verrou_d_un_proprietaire_tue_ne_bloque_plus_le_cache() {
    let (root, source, cache) = grid_fixture("verrou-tue", 96);
    let mut owner = compiler(&source, &cache)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("propriétaire");
    wait_for(&lock_path(&cache));
    owner.kill().expect("arrêt forcé");
    let status = owner.wait().expect("fin du propriétaire");
    let pointer = cache.join("native").join("full").join("manifest.json");
    assert!(!status.success(), "le propriétaire devait mourir en chemin");
    assert!(!pointer.exists(), "rien n'a été publié avant l'arrêt forcé");
    let output = compiler(&source, &cache)
        .env("WG_CACHE_LOCK_WAIT_MS", "0")
        .stdin(Stdio::null())
        .output()
        .expect("relance");
    let relaunch = outcome(&output);
    assert_eq!(relaunch["status"], "ready", "{relaunch}");
    assert!(pointer.exists(), "la relance publie son pointeur");
    fs::remove_dir_all(root).ok();
}

/// A18 : un propriétaire vivant, lui, garde le cache. Le second renonce, et dans le délai annoncé
/// par la variable documentée, sans attendre les trente secondes par défaut.
#[test]
fn a18_un_proprietaire_vivant_fait_renoncer_le_second_dans_le_delai_annonce() {
    let (root, source, cache) = fixture("verrou-vivant");
    let held = hold(&cache);
    let started = Instant::now();
    let output = compiler(&source, &cache)
        .env("WG_CACHE_LOCK_WAIT_MS", "300")
        .stdin(Stdio::null())
        .output()
        .expect("second");
    let waited = started.elapsed();
    let refusal = outcome(&output);
    assert_eq!(refusal["code"], "CACHE_LOCKED", "{refusal}");
    assert_eq!(output.status.code(), Some(2));
    assert!(
        waited < Duration::from_secs(10),
        "attente tenue : {waited:?}"
    );
    drop(held);
    fs::remove_dir_all(root).ok();
}
