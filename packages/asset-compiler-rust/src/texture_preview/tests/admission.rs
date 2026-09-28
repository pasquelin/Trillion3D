use super::*;

fn run(root: &Path, ram: usize, cancelled: bool) -> Result<Vec<TexturePreview>> {
    let mut o = options(root);
    o.ram_budget_mb = ram;
    o.cache = root.join(format!("cache-{ram}"));
    o.cancelled.store(cancelled, Ordering::Relaxed);
    let g = json!({"materials":[{"pbrMetallicRoughness":{"baseColorTexture":{"index":0}}},
        {"occlusionTexture":{"index":1}}],"meshes":[{"primitives":[{"material":0},{"material":1}]}],
        "textures":[{"source":0},{"source":1}],"images":[{"uri":"a.png"},{"uri":"b.png"}]});
    rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build()
        .unwrap()
        .install(|| {
            stage_texture_previews(
                &PreviewInputs {
                    o: &o,
                    reserved_bytes: 0,
                    g: &g,
                    bin: &[],
                    image_root: root,
                    meshes: &BTreeSet::from([0]),
                    view_map: &BTreeMap::new(),
                    to_measure: &BTreeSet::new(),
                    measurements: crate::cutout::MeasureCache::EMPTY,
                },
                &|_| {},
            )
            .map(|(p, _, _)| p)
        })
}

#[test]
fn constrained_waves_preserve_mips_and_block_tails_byte_for_byte() {
    let root = temp_dir("admission");
    for name in ["a.png", "b.png"] {
        rgba_from(256, 256, |x, y| [x as u8, y as u8, 77, 255])
            .save(root.join(name))
            .unwrap();
    }
    let serial = run(&root, 2, false).unwrap();
    let parallel = run(&root, 64, false).unwrap();
    assert_eq!(serial.len(), 2);
    for (a, b) in serial.iter().zip(&parallel) {
        assert_eq!(
            (
                a.texture,
                a.image,
                a.width,
                a.height,
                a.first_level,
                a.baked_levels
            ),
            (
                b.texture,
                b.image,
                b.width,
                b.height,
                b.first_level,
                b.baked_levels
            )
        );
        assert_eq!(a.pixels, b.pixels);
        assert_eq!(a.blocks, b.blocks);
        assert_eq!(a.layouts, b.layouts);
        for level in 0..a.baked_levels {
            let path = level_path(&a.sha256, a.kind, level, LOSSLESS);
            assert_eq!(
                fs::read(root.join("cache-2/native").join(&path)).unwrap(),
                fs::read(root.join("cache-64/native").join(&path)).unwrap()
            );
        }
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn a_single_oversized_image_is_an_admission_error_not_a_white_texture() {
    let root = temp_dir("admission-refusal");
    for name in ["a.png", "b.png"] {
        rgba_from(256, 256, |_, _| [0, 0, 0, 255])
            .save(root.join(name))
            .unwrap();
    }
    assert_eq!(
        run(&root, 1, false).err().unwrap().code,
        "RAM_ADMISSION_BUDGET_EXCEEDED"
    );
    assert!(!root.join("cache-1").exists());
    assert_eq!(run(&root, 64, true).err().unwrap().code, "CANCELLED");
    fs::remove_dir_all(root).unwrap();
}
