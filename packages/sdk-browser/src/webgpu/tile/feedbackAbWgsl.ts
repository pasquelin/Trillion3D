import { fragmentMembersWgsl, type FragmentField } from '../../gpu/core/fragmentOutputs.ts'

/** A measurement-only fragment entry with the same colour outputs and no feedback target. */
export function feedbackFreeEntry(
  shader: string,
  entry: string,
  output: string,
  fields: readonly FragmentField[],
  parameters: string,
  arguments_: string,
) {
  const marked = `@fragment fn ${entry}(${parameters}`
  if (!shader.includes(marked)) throw new Error(`FEEDBACK_ENTRY_MISSING:${entry}`)
  const members = fragmentMembersWgsl(fields)
  const values = fields.map(({ name }) => `result.${name}`).join(',')
  const plain = parameters.replace(/@builtin\([^)]*\)\s*/g, '')
  const source = shader
    .replace(marked, `fn ${entry}Source(${plain}`)
    .replace(new RegExp(`struct ${output}\\{[^}]*\\}`), (structText) =>
      structText.replace(/@location\(\d+\)\s*/g, ''),
    )
  // A second entry of the same output reuses the struct the first declared.
  const declared = source.includes(`struct ${output}WithoutFeedback{`)
  return `${source}
${declared ? '' : `struct ${output}WithoutFeedback{${members}}`}
@fragment fn ${entry}WithoutFeedback(${parameters})->${output}WithoutFeedback{
 let result=${entry}Source(${arguments_});
 return ${output}WithoutFeedback(${values});
}`
}
