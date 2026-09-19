//! A18 and A19: cache lock, viewed from the outside, per process. What these tests verify:
//! a lock that no one holds does not block anything, a living owner causes a second process
//! to give up within the announced timeout, and waiting re-reads the cancellation token.
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

/// The lock path under the cache: a contract, as a host may see it appear.
fn lock_path(cache: &Path) -> PathBuf {
    cache.join("native").join(".lock")
}
/// The lock file opened as a compilation opens it: created if missing, never truncated.
fn open_lock(cache: &Path) -> File {
    fs::create_dir_all(cache.join("native")).expect("native");
    fs::OpenOptions::new()
        .write(true)
        .create(true)
        .truncate(false)
        .open(lock_path(cache))
        .expect("lock open")
}
/// The lock acquired as a living compilation acquires it. Holding it from the test itself, and
/// not from a process that compiles, makes the test independent of any duration.
fn hold(cache: &Path) -> File {
    let file = open_lock(cache);
    file.try_lock().expect("the lock is free before the trial");
    file
}
/// The single line that the program writes to its output: the pointer, or the refusal.
fn outcome(output: &Output) -> Value {
    let printed = lines(&String::from_utf8_lossy(&output.stdout));
    assert_eq!(printed.len(), 1, "une seule ligne de sortie");
    printed[0].clone()
}
/// Waits for the lock file to appear, meaning the compilation has entered the cache.
fn wait_for(path: &Path) {
    let deadline = Instant::now() + Duration::from_secs(60);
    while !path.exists() {
        assert!(Instant::now() < deadline, "le verrou n'est jamais apparu");
        std::thread::sleep(Duration::from_millis(5));
    }
}

/// A18: the lock owner is killed abruptly mid-compilation. No one holds anything anymore,
/// and the system recorded it upon the process's death: the relaunch must take the lock on the first
/// try. Zero wait, so the test measures no duration: it succeeds, or it is refused.
#[test]
fn a18_le_verrou_d_un_proprietaire_tue_ne_bloque_plus_le_cache() {
    let (root, source, cache) = grid_fixture("verrou-tue", 96);
    let mut owner = compiler(&source, &cache)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .expect("owner");
    wait_for(&lock_path(&cache));
    owner.kill().expect("forced stop");
    let status = owner.wait().expect("owner ended");
    let pointer = cache.join("native").join("full").join("manifest.json");
    assert!(!status.success(), "the owner had to die mid-way");
    assert!(
        !pointer.exists(),
        "nothing was published before the forced stop"
    );
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

/// A18: a living owner, on the other hand, keeps the cache. The second gives up, and within the timeout announced
/// by the documented variable, without waiting for the default thirty seconds.
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

/// A19: cancelled while waiting for the lock, the second exits with `CANCELLED`, immediately, without
/// waiting for the deadline; the owner's lock itself is not touched.
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
    // Job accepted, initial cancellation check passed: what follows can only be
    // a cancellation read while waiting for the lock, not at the compilation threshold.
    let mut events = BufReader::new(second.stderr.take().expect("events"));
    let mut first = String::new();
    events.read_line(&mut first).expect("first event");
    let accepted: Value = serde_json::from_str(&first).expect("JSON event");
    assert_eq!(accepted["event"], "accepted", "{accepted}");
    std::thread::sleep(Duration::from_millis(200));
    let sent = Instant::now();
    second
        .stdin
        .take()
        .expect("stdin")
        .write_all(b"{\"cancel\":\"*\"}\n")
        .expect("cancel");
    let output = second.wait_with_output().expect("fin du second");
    let answered = sent.elapsed();
    let refusal = outcome(&output);
    assert_eq!(refusal["code"], "CANCELLED", "{refusal}");
    assert!(answered < Duration::from_secs(3), "answer: {answered:?}");
    assert!(
        open_lock(&cache).try_lock().is_err(),
        "the owner's lock did not move"
    );
    drop(held);
    fs::remove_dir_all(root).ok();
}
