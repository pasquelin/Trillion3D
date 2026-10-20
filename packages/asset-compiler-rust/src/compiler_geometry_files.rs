//! THE GEOMETRY CONTAINERS: every streaming bundle of the compile's geometry pages in a few files,
//! end to end, a bundle read by one byte range. A page is never a file of its own: a browser asks
//! a handful of requests at once, and the queue reads the bundles a view asks side by side in a
//! file by one request (`sdk-browser/src/geometry/streaming/queueRanges.ts`).
//!
//! Order: the pinned bundles of every primitive first — the root covers, what the first image
//! draws —, then the others precision band by band from the coarsest (`page_band`), within a band
//! the primitives in manifest order, each primitive's bundles in its own order: what a view needs
//! first lies at the front, and one object's bundles at one distance lie together. A file closes
//! past `GEOMETRY_FILE_BYTES`; a bundle is never cut.
//!
//! Cost: the places are laid first, then the containers are filled, hashed and stored side by side,
//! each run (`compiler_primitive_pages.rs`) opened once per container and the bundles that follow
//! one another in it and in the container read as one; each run's scratch file then goes. A page
//! found in a container an earlier compile stored is counted reused.
use super::*;
use std::io::{Read, Seek, SeekFrom};

/// Bytes past which a container closes: a few files for a city, each small enough that a server
/// answering a range with the whole file stays a bounded mistake.
pub(crate) const GEOMETRY_FILE_BYTES: usize = 64 * 1024 * 1024;

/// A bundle's bytes on their way to a container: its primitive, the run they lie in from `start`,
/// their length, and where they land.
struct Piece<'a> {
    primitive: usize,
    run: &'a Path,
    start: usize,
    bytes: usize,
    offset: usize,
}

/// Lays the bundles of `primitives`, whose runs are `runs` (`None`: no pages), into the geometry
/// containers, stored by digest; each primitive's `streams` names its bundles' `file` and `offset`
/// there, and its `reusedPages` the pages in containers already stored. Returns the files,
/// `{url, sha256, bytes}` each, in order.
pub(super) fn write_geometry_files(
    o: &Options,
    primitives: &mut [Value],
    runs: Vec<Option<PageRun>>,
) -> Result<Vec<Value>> {
    // Every bundle in run order; the pinned ones (no band) first, then the bands from the
    // coarsest: the sort is stable, so the primitives and their bundles keep their order in a band.
    let mut order: Vec<(usize, usize, &PageRun)> = (runs.iter().enumerate())
        .flat_map(|(primitive, run)| run.iter().map(move |run| (primitive, run)))
        .flat_map(|(primitive, run)| (0..run.bundles.len()).map(move |b| (primitive, b, run)))
        .collect();
    order.sort_by_key(|&(_, b, run)| run.bundles[b].band.map(std::cmp::Reverse));
    let mut placed: Vec<Vec<(usize, usize)>> = (runs.iter())
        .map(|run| {
            run.iter()
                .flat_map(|run| &run.bundles)
                .map(|_| (0, 0))
                .collect()
        })
        .collect();
    let mut files: Vec<(usize, Vec<Piece>)> = vec![(0, Vec::new())];
    for (primitive, b, run) in order {
        let (start, bytes) = (run.bundles[b].start, run.bundles[b].bytes);
        let full = files
            .last()
            .is_some_and(|(size, _)| *size > 0 && size + bytes > GEOMETRY_FILE_BYTES);
        if full {
            files.push((0, Vec::new()));
        }
        let (file, (size, pieces)) = (files.len() - 1, files.last_mut().expect("a file"));
        placed[primitive][b] = (file, *size);
        let run = &run.path;
        pieces.push(Piece {
            primitive,
            run,
            start,
            bytes,
            offset: *size,
        });
        *size += bytes;
    }
    let (stored, found): (Vec<Value>, Vec<bool>) = (files.into_par_iter())
        .map(|(size, pieces)| -> Result<(Value, bool)> {
            check(o)?;
            let mut bytes = vec![0u8; size];
            fill(&mut bytes, pieces)?;
            store_descriptor(o, &bytes)
        })
        .collect::<Result<Vec<_>>>()?
        .into_iter()
        .unzip();
    for ((primitive, run), placed) in primitives.iter_mut().zip(runs).zip(placed) {
        let Some(run) = run else {
            primitive["reusedPages"] = json!(0);
            continue;
        };
        let mut reused = 0;
        let bundles: Vec<Value> = (run.bundles.into_iter().zip(placed))
            .map(|(bundle, (file, offset))| {
                reused += if found[file] { bundle.count } else { 0 };
                let mut entry =
                    json!({"file":file,"offset":offset,"bytes":bundle.bytes,"count":bundle.count});
                entry["sha256"] = Value::String(hex_of(bundle.sha256));
                entry["dependencies"] = Value::from(bundle.dependencies);
                entry
            })
            .collect();
        primitive["streams"] = json!({"version":STRUCTURE_VERSION,"pinned":run.pinned,
            "bundleBytes":STREAM_BUNDLE_BYTES,"dependencyBound":run.dependency_bound,
            "maxDependencies":run.max_dependencies});
        primitive["streams"]["pages"] = Value::Array(bundles);
        primitive["reusedPages"] = json!(reused);
        fs::remove_file(&run.path)?;
    }
    Ok(stored)
}

/// Fills `container` with its `pieces`: each run opened once, and the pieces that follow one
/// another in the run and in the container read as one.
fn fill(container: &mut [u8], mut pieces: Vec<Piece<'_>>) -> Result<()> {
    pieces.sort_unstable_by_key(|piece| (piece.primitive, piece.start));
    let mut reads: Vec<Piece> = Vec::with_capacity(pieces.len());
    for piece in pieces {
        match reads.last_mut() {
            Some(last)
                if last.primitive == piece.primitive
                    && last.start + last.bytes == piece.start
                    && last.offset + last.bytes == piece.offset =>
            {
                last.bytes += piece.bytes
            }
            _ => reads.push(piece),
        }
    }
    for run in reads.chunk_by(|a, b| a.primitive == b.primitive) {
        let mut source = fs::File::open(run[0].run)?;
        for read in run {
            source.seek(SeekFrom::Start(read.start as u64))?;
            source.read_exact(&mut container[read.offset..read.offset + read.bytes])?;
        }
    }
    Ok(())
}
