use std::fs;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

static NEXT_FIXTURE_ID: AtomicU64 = AtomicU64::new(0);

/// Each fixture owns its directory, even when concurrent calls share a clock tick.
pub(super) fn scratch(prefix: &str, tag: &str) -> PathBuf {
    scratch_at(
        prefix,
        tag,
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos(),
    )
}

fn scratch_at(prefix: &str, tag: &str, stamp: u128) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "trillion3d-{prefix}-{tag}-{}-{stamp}-{}",
        std::process::id(),
        NEXT_FIXTURE_ID.fetch_add(1, Ordering::Relaxed),
    ));
    fs::create_dir(&dir).expect("new temp dir");
    dir
}

#[test]
fn concurrent_fixtures_at_the_same_timestamp_own_distinct_directories() {
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("clock")
        .as_nanos();
    let roots = std::thread::scope(|scope| {
        let workers: Vec<_> = (0..4)
            .map(|_| {
                scope.spawn(|| {
                    (0..8)
                        .map(|_| scratch_at("fixture", "same-tick", stamp))
                        .collect::<Vec<_>>()
                })
            })
            .collect();
        workers
            .into_iter()
            .flat_map(|worker| worker.join().expect("fixture worker"))
            .collect::<Vec<_>>()
    });
    let unique: std::collections::HashSet<_> = roots.iter().collect();
    for root in &unique {
        fs::remove_dir_all(root).expect("independent cleanup");
    }
    assert_eq!(
        unique.len(),
        roots.len(),
        "fixtures must never share a directory"
    );
}
