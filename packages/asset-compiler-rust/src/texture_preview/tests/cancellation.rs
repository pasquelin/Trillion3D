use super::*;
use std::thread;
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

// Comportement 8 : la cancellation est revérifiée avant chaque texture, jamais seulement au
// début — un décodage déjà en cours n'est pas interrompu, mais la texture suivante ne démarre pas.
// Deux exécutions comparées : cancellation déjà posée avant l'appel (retour immédiat) contre
// cancellation posée par un autre fil pendant que la première, grosse texture se décode (retour
// seulement après ce travail) ; la seconde doit mesurablement durer plus longtemps.
#[test]
fn cancellation_is_honoured_between_two_textures_not_mid_decode() {
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
    let started = Instant::now();
    let immediate = stage_texture_previews(&PreviewInputs {
        o: &already_cancelled,
        g: &g,
        bin: &[],
        image_root: &dir,
        meshes: &meshes,
        view_map: &view_map,
    });
    let immediate_elapsed = started.elapsed();
    assert_eq!(immediate.err().expect("cancelled").code, "CANCELLED");

    let mid_flight = options(&dir);
    let flag = mid_flight.cancelled.clone();
    thread::spawn(move || flag.store(true, Ordering::Relaxed));
    let started = Instant::now();
    let interrupted = stage_texture_previews(&PreviewInputs {
        o: &mid_flight,
        g: &g,
        bin: &[],
        image_root: &dir,
        meshes: &meshes,
        view_map: &view_map,
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
