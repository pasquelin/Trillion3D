use super::*;
use std::sync::{atomic::AtomicUsize, Barrier};

#[test]
fn a_wave_bounds_live_work_and_keeps_input_order() {
    let pool = rayon::ThreadPoolBuilder::new()
        .num_threads(4)
        .build()
        .unwrap();
    let live = AtomicUsize::new(0);
    let peak = AtomicUsize::new(0);
    let pair = Barrier::new(2);
    let costs = [Cost {
        working: 30,
        retained: 10,
    }; 4];
    let results = pool
        .install(|| {
            execute(&costs, 100, |index| {
                let active = live.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(active, Ordering::SeqCst);
                pair.wait();
                live.fetch_sub(1, Ordering::SeqCst);
                Ok(index)
            })
        })
        .unwrap();
    assert_eq!(peak.load(Ordering::SeqCst), 2);
    assert_eq!(results, [0, 1, 2, 3]);
}

#[test]
fn impossible_image_or_retained_tails_fail_before_work() {
    let calls = AtomicUsize::new(0);
    for costs in [
        vec![Cost {
            working: 101,
            retained: 0,
        }],
        vec![
            Cost {
                working: 1,
                retained: 51
            };
            2
        ],
        vec![
            Cost {
                working: 0,
                retained: usize::MAX
            };
            2
        ],
    ] {
        let error = execute(&costs, 100, |_| {
            calls.fetch_add(1, Ordering::Relaxed);
            Ok(())
        })
        .unwrap_err();
        assert_eq!(error.code, "RAM_ADMISSION_BUDGET_EXCEEDED");
    }
    assert_eq!(calls.load(Ordering::Relaxed), 0);
}

#[test]
fn varying_weights_and_thin_images_keep_every_wave_within_its_allowance() {
    let costs = [
        Cost {
            working: 60,
            retained: 5,
        },
        Cost {
            working: 20,
            retained: 5,
        },
        Cost {
            working: 40,
            retained: 5,
        },
        Cost {
            working: 30,
            retained: 5,
        },
    ];
    assert_eq!(waves(&costs, 100, 4).unwrap(), [0..2, 2..4]);
    let cost = cost::estimate(1, 16384, 128, 3, 2);
    assert_eq!(
        cost.retained,
        3 * (preview_pixel_bytes(1, 16384) + 2 * preview_block_bytes(1, 16384))
    );
    assert!(cost.working >= 128 + 16384 * 20);
    assert!(waves(
        &[cost::estimate(u32::MAX, u32::MAX, usize::MAX, 3, 2)],
        1024,
        4
    )
    .is_err());
}

#[test]
fn every_registered_image_header_agrees_with_its_actual_decoder() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/formats");
    let fixtures = [
        "png/rgb8.png",
        "tga/vraies-couleurs-32-rle-haut.tga",
        "tiff/rgb8-brut-ii.tiff",
        "webp/sans-perte.webp",
        "bmp/vraies-couleurs-24-bas.bmp",
        "gif/palette-globale.gif",
        "dds/bc1-mips.dds",
        "ktx2/base-zstd.ktx2",
        "psd/rgba-rle.psd",
        "hdr/plat.hdr",
        "exr/demi.exr",
    ];
    let mut sources: Vec<_> = fixtures
        .iter()
        .map(|f| fs::read(root.join(f)).unwrap())
        .collect();
    let mut jpeg = std::io::Cursor::new(Vec::new());
    image::DynamicImage::new_rgb8(3, 2)
        .write_to(&mut jpeg, image::ImageFormat::Jpeg)
        .unwrap();
    sources.push(jpeg.into_inner());
    let mut names = BTreeSet::new();
    for bytes in sources {
        let driver = crate::plugins::image::by_head(&bytes).unwrap();
        names.insert(driver.name());
        let expected = match driver.decode(&bytes, PREVIEW_MAX_ALLOC).unwrap().image {
            crate::plugins::image::DecodedImage::Rgba8(image) => image.dimensions(),
            crate::plugins::image::DecodedImage::RgbaF32 { width, height, .. } => (width, height),
        };
        assert_eq!(
            driver.dimensions(&bytes).unwrap(),
            expected,
            "{}",
            driver.name()
        );
    }
    assert_eq!(names.len(), crate::plugins::image::DECODERS.len());
}

#[test]
fn supercompression_payload_is_charged_even_for_a_tiny_surface() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR")).join("../../tests/fixtures/formats");
    let mut bytes = fs::read(root.join("ktx2/base-zstd.ktx2")).unwrap();
    bytes[96..104].copy_from_slice(&(512u64 * 1024 * 1024).to_le_bytes());
    let driver = crate::plugins::image::by_head(&bytes).unwrap();
    let (w, h) = driver.dimensions(&bytes).unwrap();
    let cost = cost::estimate(
        w,
        h,
        bytes.len() + driver.expanded_payload_bytes(&bytes).unwrap(),
        1,
        1,
    );
    assert!(waves(&[cost], 64 * 1024 * 1024, 4).is_err());
}
