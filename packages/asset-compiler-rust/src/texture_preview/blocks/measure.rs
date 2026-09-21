//! The declared loss of the two block codecs, measured on real textures: every
//! image of a folder is encoded in both formats, decoded by the independent
//! decoder, and its PSNR and encode time written to a JSON report. Ignored by
//! default — it reads a folder the repository does not carry —, launched with
//! `pnpm run mesure:blocs:natif` (`WG_BLOCK_MEASURE_DIR`, `WG_BLOCK_MEASURE_OUT`);
//! the numbers the documentation quotes come from its report, never from memory.
use super::tests::{decode, psnr};
use super::*;
use serde_json::json;
use std::time::Instant;

#[test]
#[ignore = "reads a texture folder named by WG_BLOCK_MEASURE_DIR; run by hand, its report published"]
fn measure_the_loss_of_both_codecs_on_a_texture_folder() {
    let dir = std::env::var("WG_BLOCK_MEASURE_DIR").expect("WG_BLOCK_MEASURE_DIR");
    let out = std::env::var("WG_BLOCK_MEASURE_OUT").expect("WG_BLOCK_MEASURE_OUT");
    let mut paths: Vec<_> = std::fs::read_dir(&dir)
        .expect("folder")
        .flatten()
        .map(|entry| entry.path())
        .filter(|path| {
            path.extension()
                .is_some_and(|ext| ext == "png" || ext == "jpg")
        })
        .collect();
    paths.sort();
    let mut rows = Vec::new();
    for path in &paths {
        let Ok(image) = image::open(path) else {
            continue;
        };
        let image = image.to_rgba8();
        let (w, h) = (image.width(), image.height());
        let started = Instant::now();
        let levels = encode_level(image.as_raw(), w, h);
        let ms = started.elapsed().as_secs_f64() * 1000.0;
        // An exact image has no finite PSNR: it is written as `null`, ranked above everything.
        let quality: Vec<Option<f64>> = BlockFormat::ALL
            .iter()
            .zip(&levels)
            .map(|(format, level)| {
                let db = psnr(&decode(level, w, h, *format), image.as_raw());
                db.is_finite().then_some(db)
            })
            .collect();
        rows.push(json!({
            "file": path.file_name().and_then(|n| n.to_str()),
            "width": w, "height": h, "bothFormatsMs": ms,
            "psnrDb": {"bc7": quality[0], "astc": quality[1]},
        }));
    }
    let db = |name: &str| {
        let mut values: Vec<f64> = rows
            .iter()
            .map(|r| r["psnrDb"][name].as_f64().unwrap_or(f64::INFINITY))
            .collect();
        values.sort_by(|a, b| a.total_cmp(b));
        let at = |q: f64| values[((values.len() - 1) as f64 * q).round() as usize];
        let exact = values.iter().filter(|v| v.is_infinite()).count();
        json!({"min": at(0.0), "p10": at(0.1), "median": at(0.5), "p90": at(0.9), "exactImages": exact})
    };
    let report = json!({
        "tool": "cargo test -- --ignored measure_the_loss_of_both_codecs_on_a_texture_folder",
        "folder": dir, "images": rows.len(), "encoder": {"bc7": "mode 6", "astc": "4x4, one partition, CEM 12, 192-level endpoints, 3-bit weights"},
        "psnrDb": {"bc7": db("bc7"), "astc": db("astc")},
        "threads": rayon::current_num_threads(), "rows": rows,
    });
    std::fs::write(&out, serde_json::to_vec_pretty(&report).expect("json")).expect("report");
    eprintln!(
        "{}",
        serde_json::to_string_pretty(&report["psnrDb"]).expect("json")
    );
}
