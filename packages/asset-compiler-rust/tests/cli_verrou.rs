//! A18 et A19 : le verrou d'un cache, vu de l'extérieur, par processus. Ce que ces épreuves
//! tiennent : un verrou que plus personne ne détient ne bloque rien, un propriétaire vivant fait
//! renoncer le second dans le délai annoncé, et l'attente relit le jeton d'annulation.
mod common;
use common::{compiler, fixture, grid_fixture, lines};
use serde_json::Value;
use std::{
    fs::{self, File},
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Output, Stdio},
    time::{Duration, Instant},
};

/// Le chemin du verrou sous le cache : un contrat, puisqu'un hôte peut le voir paraître.
fn lock_path(cache: &Path) -> PathBuf {
    cache.join("native").join(".lock")
}
/// Le fichier de verrou ouvert comme l'ouvre une compilation : créé s'il manque, jamais tronqué.
fn open_lock(cache: &Path) -> File {
    fs::create_dir_all(cache.join("native")).expect("native");
    fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path(cache))
        .expect("ouverture du verrou")
}
/// Le verrou pris comme le prend une compilation vivante. Le tenir depuis l'épreuve elle-même, et
/// non depuis un processus qui compile, rend l'épreuve indépendante de toute durée.
fn hold(cache: &Path) -> File {
    let file = open_lock(cache);
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

/// A19 : annulé pendant l'attente du verrou, le second sort en `CANCELLED`, et tout de suite, sans
/// attendre l'échéance ; le verrou du propriétaire, lui, n'est pas touché.
#[test]
fn a19_l_annulation_pendant_l_attente_du_verrou_sort_en_annule() {
    let (root, source, cache) = fixture("verrou-annule");
    let held = hold(&cache);
    let mut second = compiler(&source, &cache)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("second");
    // Le travail accepté, le contrôle d'annulation d'entrée est passé : ce qui suit ne peut plus
    // être qu'une annulation lue dans l'attente du verrou, et non au seuil de la compilation.
    let mut events = BufReader::new(second.stderr.take().expect("événements"));
    let mut first = String::new();
    events.read_line(&mut first).expect("premier événement");
    let accepted: Value = serde_json::from_str(&first).expect("événement JSON");
    assert_eq!(accepted["event"], "accepted", "{accepted}");
    std::thread::sleep(Duration::from_millis(200));
    let sent = Instant::now();
    second
        .stdin
        .take()
        .expect("entrée")
        .write_all(b"{\"cancel\":\"*\"}\n")
        .expect("annulation");
    let output = second.wait_with_output().expect("fin du second");
    let answered = sent.elapsed();
    let refusal = outcome(&output);
    assert_eq!(refusal["code"], "CANCELLED", "{refusal}");
    assert!(answered < Duration::from_secs(3), "réponse : {answered:?}");
    assert!(
        open_lock(&cache).try_lock().is_err(),
        "le verrou du propriétaire n'a pas bougé"
    );
    drop(held);
    fs::remove_dir_all(root).ok();
}
