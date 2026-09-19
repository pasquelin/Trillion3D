//! The `.zip` container facing a payload its index announces and the reader does not unpack.
use super::*;
use crate::plugins::scene::zip::ZIP;

/// Bytes that are not a `deflate` stream: the first block announces a reserved type.
const GARBAGE: &[u8] = b"\x06\x00\x00\x00\x00pas un flux deflate";

/// An archive whose first entry reads and whose second lies about its payload.
fn corrupted() -> Vec<u8> {
    zip_bytes(
        &[
            Entry::stored("scene.gltf", b"{}"),
            Entry {
                name: "textures/checker.png",
                data: GARBAGE,
                method: 8,
                size: 4096,
            },
        ],
        false,
    )
}

// Behaviour 5: an archive whose index holds but whose payload does not unpack is refused under
// the unreadable-archive name — and not as a disk failure —, and extraction leaves nothing
// behind: the extracted directory appears only complete, never half-written.
#[test]
fn an_archive_whose_payload_does_not_unpack_is_refused_without_leaving_partial_files() {
    let run = outcome("zip-charge", &ZIP, "abimee.zip", &corrupted());
    assert_eq!(run.code, UNREADABLE);
    assert!(
        extracted(&run.dir).is_empty(),
        "a refused archive leaves no extracted directory"
    );
    cleanup(run.dir);
}
