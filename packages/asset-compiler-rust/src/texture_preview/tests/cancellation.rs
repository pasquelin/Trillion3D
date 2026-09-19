use super::*;
use std::time::Instant;

fn scene_with_two_textures() -> Value {
    json!({
        "materials": [
            {"pbrMetallicRoughness": {"baseColorTexture": {"index": 0}}},
            {"emissiveTexture": {"index": 1}},
        ],
        "meshes": [{"primitives": [
            {"attributes": {}, "material": 0},
            {"attributes": {}, "material": 1},
        ]}],
        "textures": [{"source": 0}, {"source": 1}],
        "images": [{"uri": "big.png"}, {"uri": "small.png"}],
    })
}

/// Single-thread batch: images follow in index order, as in
/// single-thread job; second starts only after first. Built BEFORE
/// race begins: construction takes longer than thread flagging.
fn one_thread() -> rayon::ThreadPool {
    rayon::ThreadPoolBuilder::new()
        .num_threads(1)
        .build()
        .expect("grappe")
}

// Behavior 8: cancellation re-checked before each image, not just start —
// decode in progress not interrupted, but next image does not start.
// Two runs compared: cancellation set before call (immediate return) vs
// cancellation set by first image progress report, right after
// decode (return only after that work); second takes measurably longer.
// Flag set by progress, not another thread: no race.
#[test]
fn cancellation_is_honoured_between_two_images_not_mid_decode() {
    let dir = temp_dir("cancel-between");
    let big = rgba_from(2200, 2200, |x, y| {
        [(x % 256) as u8, (y % 256) as u8, 5, 255]
    });
    big.save(dir.join("big.png")).expect("save big png");
    rgba_from(4, 4, |_, _| [1, 2, 3, 255])
        .save(dir.join("small.png"))
        .expect("save small png");
    let g = scene_with_two_textures();
    let meshes = BTreeSet::from([0usize]);
    let view_map = BTreeMap::new();

    let already_cancelled = options(&dir);
    already_cancelled.cancelled.store(true, Ordering::Relaxed);
    let pool = one_thread();
    let started = Instant::now();
    let immediate = pool.install(|| {
        stage_texture_previews(
            &PreviewInputs {
                o: &already_cancelled,
                g: &g,
                bin: &[],
                image_root: &dir,
                meshes: &meshes,
                view_map: &view_map,
                to_measure: &BTreeSet::new(),
            },
            &silent,
        )
    });
    let immediate_elapsed = started.elapsed();
    assert_eq!(immediate.err().expect("cancelled").code, "CANCELLED");

    let mid_flight = options(&dir);
    let flag = mid_flight.cancelled.clone();
    let pool = one_thread();
    let after_first_image = move |_: Value| flag.store(true, Ordering::Relaxed);
    let started = Instant::now();
    let interrupted = pool.install(|| {
        stage_texture_previews(
            &PreviewInputs {
                o: &mid_flight,
                g: &g,
                bin: &[],
                image_root: &dir,
                meshes: &meshes,
                view_map: &view_map,
                to_measure: &BTreeSet::new(),
            },
            &after_first_image,
        )
    });
    let mid_flight_elapsed = started.elapsed();
    assert_eq!(interrupted.err().expect("cancelled").code, "CANCELLED");
    assert!(
        mid_flight_elapsed > immediate_elapsed,
        "a cancellation set during the first texture's decode must let that \
         decode finish before the next is refused: {mid_flight_elapsed:?} \
         should exceed {immediate_elapsed:?}"
    );
}
