# Working rules

## Commits: small and frequent
- One logical change per commit: one fix, one drawing (source + points + cut + registration together), one tool change, one doc update. Never batch many drawings or unrelated fixes into one commit.
- Commit as soon as a change type-checks (`npx tsc --noEmit`) and does what it should; don't hold work until the whole task is done.
- Agents in worktrees: commit each step on the branch as you go; the session merges to main and pushes often, not once at the end.
- Push main after every merge (`git push origin main`); GitHub Pages deploys from it.
- Messages: `Area: what changed (why)`, e.g. `Rigs: reload drawing for surv_smg`.

## Checks before a merge
`npx tsc --noEmit && npm run build && npx tsx tools/simtest.ts 2`, plus `node tools/e2e/smoke.cjs` (and `pose-check.cjs` for rig/anim changes) against `vite preview`.

## Visual work
Inspect at full resolution and crop; don't judge from thumbnails.
