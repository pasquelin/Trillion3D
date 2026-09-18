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

/// Une grappe d'un seul fil : les images se suivent dans l'ordre de leur index, comme dans un
/// travail dont `threads` vaut un, et la seconde ne démarre qu'après la première. Bâtie AVANT que
/// la course commence : sa construction prend plus longtemps qu'un fil ne met à poser un drapeau.
fn one_thread() -> rayon::ThreadPool {
    rayon::ThreadPoolBuilder::new()
        .num_threads(1)
        .build()
        .expect("grappe")
}

// Comportement 8 : la cancellation est revérifiée avant chaque image, jamais seulement au début —
// un décodage déjà en cours n'est pas interrompu, mais l'image suivante ne démarre pas. Deux
// exécutions comparées : cancellation déjà posée avant l'appel (retour immédiat) contre
// cancellation posée par le rapport de progrès de la première image, c'est-à-dire juste après son
// décodage (retour seulement après ce travail) ; la seconde doit mesurablement durer plus
// longtemps. Le drapeau est posé par le progrès et non par un autre fil : aucune course.
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
        "une cancellation posée pendant le décodage de la première texture doit laisser ce \
         décodage se terminer avant que la suivante ne soit refusée : {mid_flight_elapsed:?} \
         devrait dépasser {immediate_elapsed:?}"
    );
}
