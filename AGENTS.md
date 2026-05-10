# AGENTS.md — Sprite Rig Lab

Rules for Codex contributors:
- Keep changes surgical and deterministic.
- Do not add AI, SAM, backend services, auth, cloud storage, or game repo integration in this stage.
- Preserve transparent-alpha outputs.
- Keep frames centered in equal-width cells with a consistent floor lock.

Required checks before PR completion:
- npm run build
- npm run typecheck
