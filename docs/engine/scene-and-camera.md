# Scene and camera

Every node is a slot of one transform tree, walked once a frame over what changed
(`packages/sdk-core/src/world/transform/pass.ts`). A material is declared once into the one surface record its meshes wear,
`pages/surfaceRecord.ts`. The engine composes its own projection, reversed depth with an infinite far
plane, one convention for every pass (`camera/depthConvention.ts`).

A node whose parent moves and whose pose only follows it is composed once, on the GPU: its link is
a node flag (`NODE_WORLD_LAZY`, `packages/sdk-core/src/world/transform/nodeFlags.ts`) that the tree's walk
leaves alone, and the placement's compose slot is the parent's. The roots pass writes, in exact
double arithmetic, the world, the stretch and the world box of each linked root, its moved pose
named to the poses the next drawn frame keeps, from which the velocity reads its motion; the
decode of the visible clusters reads the composed worlds where it decodes them
(`visibility/decode/decodeWgsl.ts`); the members pass writes the leaf boxes the
placement tree is fitted over, and the one tree refit (`dag/tree/treeRefit.ts`, a pass any caller
names its dirty groups to) fits them and every node above, bottom up. A CPU reader — transparent
depth, a winding — reads the composed world once a frame (`composedWorld`, a
product of the parent's and the local matrix kept by `state.version`), never a second multiply that
is written back. Models and partition rows link before their rows are written, so no matrix is
written for them. A link is never refused for what reads its row: waves, soft bodies and skeletons read the
composed world of their root; rows no root reads — a blended surface's, or a root a growth has not
built yet — are composed for their readers (`compose/composeReaders.ts`) and handed to the roots
pass once their root exists. Only the pose a session opens on is written by an owner, before any
engine exists (`partition/follow.ts`, `world/models/models.ts`); every product of a parent's
world and a local matrix on the CPU is the one product `multiplyMatrix4` (`packages/math/src/matrix/matrix4.ts`), which the GPU composition reproduces word for word (`compose/gpuComposeWgsl.ts`). The refit and the members pass bind the cut's
tables as the cut does, split tables in their parts (`geometry/dag/shader/bindings.ts`).
