// No push to develop or main, nor a branch whose changes fail the local gate (`check:changed`
// against origin/develop: the CI's red, caught before the push); then the local pre-push hook
// runs with the same refs.
import { readFileSync } from 'node:fs'
import { gate, refuse, runLocalHook } from './lib.ts'

// stdin: <local ref> <local sha> <remote ref> <remote sha>, one line per ref being pushed.
const refs = `${readFileSync(0, 'utf8').replace(/\n+$/, '')}\n`
for (const line of refs.split('\n')) {
  const branch = (line.trim().split(/\s+/)[2] ?? '').replace(/^refs\/heads\//, '')
  if (branch === 'develop' || branch === 'main')
    refuse(`no push to '${branch}': open a pull request instead.`)
}
gate('node', ['scripts/check-changed.ts'], { TRILLION3D_BASE_REF: 'origin/develop' })
runLocalHook('pre-push', process.argv.slice(2), refs)
