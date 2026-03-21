# Changelog

> A running log of changes made to this project over time.
> Maintained by Claude. Update after completing each feature or milestone.

---

## [Unreleased]

### Changed
- **Architecture**: Removed n8n dependency entirely. AI processing pipeline (OCR + classification + profit calc + DB write) moves into a Supabase Edge Function (`process-transaction`). App is now fully self-contained — no homelab or external workflow engine required.
- **Next.js**: Must be configured as static export (`output: 'export'`). No SSR, no API routes. All backend logic in Supabase Edge Functions.
- **OpenAI**: Called from `process-transaction` Edge Function only. API key never exposed to client.
- **`.env.example`**: Removed n8n vars; added note that `OPENAI_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` belong in Supabase Edge Function secrets (`supabase secrets set`), not in `.env`.

---

## [v0.1.0] — 2026-03-21 — Project Setup

### Added
- `PRD.md` — full product requirements document (v3.0) covering two-phase write model, transaction types, profit calculation formulas, wallet management, and SaaS roadmap
- `TECH_SPEC.md` — technical specification (v2.1) with target architecture (Next.js + Capacitor + Supabase), database schema, API design, and infrastructure plan
- `CLAUDE.md` — project memory with tech stack, domain knowledge, constraints, and workflow rules
- `architecture.md` — system architecture overview with component map, data flow, DB schema, and tech decisions
- `project-status.md` — milestone tracker (M1: Cross-Platform App, M2: Multi-tenant, M3: Analytics)
- `changelog.md` — this file
- Template scaffolding: `.ai/prompts/`, `docs/workflow.md`, `docs/threat-models/TEMPLATE.md`, `docs/verification-template.md`, `HUMAN_GUIDE.md`, `create-issues.md`, `update-docs.md`, `retro.md`
