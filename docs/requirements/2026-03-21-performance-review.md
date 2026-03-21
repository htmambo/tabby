# 2026-03-21 Performance Review Requirement

## Goal

Inspect the current Tabby repository and produce evidence-backed optimization recommendations focused on performance, responsiveness, startup speed, bundle size, and build speed.

## Deliverable

1. A repository-grounded performance review report.
2. Prioritized optimization recommendations with impact/effort guidance.
3. `vibe` runtime artifacts for traceability.

## Scope

- Electron renderer/main build configuration
- Plugin discovery and bootstrap path
- Terminal runtime hotspots
- Recovery/persistence path
- Static asset and font payload
- Local build throughput

## Constraints

- Analysis-first task; no production code changes in this run
- Recommendations must be backed by current repository evidence
- Prefer low-risk, staged optimization advice over speculative rewrites

## Acceptance Criteria

1. At least one measured build or artifact baseline is captured.
2. Findings cite concrete source locations and current behavior.
3. Recommendations are prioritized by impact and effort.
4. Short-term and longer-term options are clearly separated.

## Non-goals

- Implementing the optimizations
- Running a full interactive Electron profiling session
- Large-scale refactors or architecture migration in this pass

## Autonomy Mode

`benchmark_autonomous`

## Inferred Assumptions

1. The user wants a practical engineering review, not a theoretical overview.
2. Static analysis plus local build/artifact inspection is sufficient for this pass.
3. Existing performance review documents from March 2026 should be treated as context, not as authoritative current state.
