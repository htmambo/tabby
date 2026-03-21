# 2026-03-21 Performance Review Execution Plan

## Internal Grade

`L`

Reason: this is a multi-step review with evidence gathering, requirement freezing, and a written recommendation set, but it does not require parallel implementation workers.

## Wave Structure

### Wave 1: Skeleton Check

- Confirm repository state and branch hygiene
- Discover existing optimization artifacts
- Verify local prerequisites (`node_modules`, Node, Yarn)

### Wave 2: Evidence Gathering

- Inspect current webpack/build configuration
- Inspect startup/plugin loading path
- Inspect terminal recovery and render hot paths
- Capture artifact size and build-time baselines

### Wave 3: Synthesis

- Rank optimization opportunities by impact vs effort
- Separate quick wins from structural work
- Write the final performance review report

### Wave 4: Cleanup

- Remove temporary measurement files
- Persist `vibe` receipts
- Leave repository changes limited to docs/runtime artifacts

## Ownership Map

- Main agent: repository inspection, baselines, report synthesis, and runtime artifact generation

## Verification Commands

1. `git status --short --branch`
2. `rg --files -g 'package.json' -g 'webpack.config.*' -g 'docs/**'`
3. `node -v && yarn -v`
4. `ls -lah app/dist`
5. `du -sh app/dist tabby-core/dist tabby-terminal/dist tabby-ssh/dist`
6. `time node scripts/build-modules.mjs > /tmp/tabby-build.log`
7. `stat -c '%n %s' app/dist/bundle.js app/dist/bundle.js.map app/dist/main.js app/dist/main.js.map app/dist/preload.js app/dist/preload.js.map tabby-core/src/icons.json`

## Rollback Strategy

- This run is documentation-only.
- If needed, revert only the new files created under `docs/requirements`, `docs/plans`, `docs/Analysis`, and `outputs/runtime/vibe-sessions/20260321-performance-review`.

## Cleanup Expectations

- Delete temporary timing logs from `/tmp`
- Do not modify application source files
- Leave a cleanup receipt recording what was removed and what was intentionally retained
