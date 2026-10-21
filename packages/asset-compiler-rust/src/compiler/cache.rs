//! The cache a compile reads and writes: its key, its lock, the reuse of a whole product, the prune, the atomic writes and the publication.
pub(crate) mod digest;
pub(crate) mod format;
pub(crate) mod identity;
pub(crate) mod lock;
pub(crate) mod prune;
pub(crate) mod prune_textures;
pub(crate) mod publish;
pub(crate) mod reuse;
pub(crate) mod reuse_proof;
pub(crate) mod storage;
