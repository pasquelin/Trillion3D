//! OBJ driver, from the published specification, read by ufbx. The neighbouring `.mtl` is followed
//! by the reader itself from the file's `mtllib` line: it is not a separate source.
use super::ufbx_driver::UfbxDriver;

/// OBJ is a headerless text format: no magic number recognises it, only the extension.
pub(super) static OBJ: UfbxDriver = UfbxDriver {
    name: "obj",
    version: "obj-ufbx-0.11.3-gltf-7",
    extensions: &["obj"],
    magic: b"",
};
