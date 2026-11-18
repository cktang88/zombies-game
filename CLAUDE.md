# Working rules

## Commits: small and frequent
- One logical change per commit: one fix, one drawing (source + points + cut + registration together), one tool change, one doc update. Never batch many drawings or unrelated fixes into one commit.
- Commit as soon as a change type-checks (`npx tsc --noEmit`) and does what it should; don't hold work until the whole task is done.
- Work on `main` directly: no feature branches, no merge commits. Each commit goes to main and is pushed right away (`git pull --rebase origin main && git push origin main`); GitHub Pages deploys from it.
- Agents (including ones in a worktree): commit each step and push it to main the same way (`git push origin HEAD:main` after `git pull --rebase origin main`); never hold commits on a branch for a later merge.
- Messages: `Area: what changed (why)`, e.g. `Rigs: reload drawing for surv_smg`.

## Checks before a merge
`npx tsc --noEmit && npm run build && npx tsx tools/simtest.ts 2`, plus `node tools/e2e/smoke.cjs` (and `pose-check.cjs` for rig/anim changes) against `vite preview`.

## Visual work
Inspect at full resolution and crop; don't judge from thumbnails.
