import { wgslBlock } from '../../../../../math/src/wgsl/decl.ts'

/**
 * The world DAG's gate in the descent (\`../worldLinks.ts\`): whether the world draws a
 * placement in its place, and the threshold each placement's cut is held to — the frame's, the
 * world DAG's scaled by its fade (\`../worldFade.ts\`). Outside the level text, so a descent of
 * another shape reads the same threshold.
 */
export const DAG_WORLD_GATE_WGSL = wgslBlock(
  'DAG_WORLD_GATE_WGSL',
  [],
  `/** The world cluster that stands in for placement \`w\` (\`../worldLinks.ts\`), or none. */
fn worldLinkOf(w:u32)->u32{return select(0xffffffffu,coldAt(views[0u].worldLinks+w),views[0u].worldLinks!=0u);}
/** \`view · world\` of the world DAG under the view \`vi\`, as \`preparePrimitive\` derives it: its
 *  world is the identity, its origin taken to the eye as a placement's is (\`worldPoseWgsl.ts\`). */
fn worldViewOf()->mat4x4f{
 let o=-views[0u].cameraWorld;
 return views[vi].view*mat4x4f(1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,o.x,o.y,o.z,1.0);
}
/** Whether the world DAG draws placement \`w\` in its place under the view \`vi\`: its object's world
 *  group is not ready — its super-roots stand in —, or that group's error projects within the
 *  threshold, the comparison its super-roots draw on, same operands, same frame (\`drawsCluster\`).
 *  Leaves \`deformReach\` at the world's: none. */
fn worldCovers(w:u32)->bool{
 let c=worldLinkOf(w);
 if(c==0xffffffffu){return false;}
 if(!isResident(c)){return true;}
 deformReach=0.0;
 // The world DAG's record shift leads its links (\`../worldLinks.ts\`).
 let cluster=clusterAt(c+coldAt(views[0u].worldLinks-1u));
 let pixels=clusterPixels(cluster,worldViewOf(),views[vi].cameraStretch,focalPixels());
 return !(pixels.x>thresholdOf(views[0u].worldRoot));
}
/** The screen error placement \`w\`'s cut is held to under the view \`vi\`: the frame's, the world
 *  DAG's — wherever the packing put it (\`worldRoot\`) — scaled by its fade (\`../worldFade.ts\`). */
fn thresholdOf(w:u32)->f32{
 let world=views[0u].worldLinks!=0u&&w==views[0u].worldRoot;
 return views[vi].pixelError*select(1.0,views[0u].worldScale,world);
}
`,
)
