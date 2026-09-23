import {
  FORMAT_VERSION,
  prepare,
  prepareMany,
  type CompilationJob,
  type CompilationResult,
  type PrepareOptions,
} from 'trillion3d';

const options: PrepareOptions = { resourceBaseUrl: 'file:///tmp/resources/' };
export const readCompilation = async (job: CompilationJob): Promise<number> => {
  const result: CompilationResult = await job.promise;
  return result.selectedNodes.length;
};

// @ts-expect-error resourceBaseUrl is required by the public Node contract.
const invalidOptions: PrepareOptions = {};

export const nodeContract = { FORMAT_VERSION, invalidOptions, options, prepare, prepareMany };
