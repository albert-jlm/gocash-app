# Human-in-the-Loop Project Guide

> **This guide is for YOU — the human.** It tells you exactly what to do at every stage,
> what to review, and when to approve before moving on.
> Claude handles the research and code. You handle the decisions and judgment.

---

## The Core Principle

> You are the **architect and decision-maker**.
> Claude is the **planner, reviewer, and security checker**.
> Codex is the **executor** — it writes the actual code.
>
> **Nothing moves forward without your explicit approval at each gate.**

---

## How to Read This Guide

Each phase shows:
- **YOU DO** — your action (thinking, deciding, reviewing)
- **CLAUDE DOES** — what you ask Claude to do
- **CODEX DOES** — what you ask Codex to do
- **GATE** — what you review and approve before moving on

---

# PHASE 0: PROJECT KICKOFF
*Before any code. Do this once per project.*

---

### 0.1 — Copy the Template

**YOU DO:**
```bash
cp -r "~/Dev Projects/project_template/" "~/Dev Projects/[your-project-name]/"
cd "~/Dev Projects/[your-project-name]/"
git init && git add . && git commit -m "chore: init project from template"
```

Open the folder in your IDE. You'll have:
```
CLAUDE.md               ← fill this in next
HUMAN_GUIDE.md          ← you're reading it
README.md               ← update after setup
prd.md                  ← fill this out in Phase 1
project-spec.md         ← fill this out in Phase 1
project-status.md       ← Claude maintains this
architecture.md         ← Claude maintains this
changelog.md            ← Claude maintains this
docs/workflow.md        ← reference during build
.ai/prompts/            ← AI role prompts (don't edit)
```

---

### 0.2 — Run the Stack Audit

**YOU DO:** Open Claude Code in your project folder. Run:
```
/stack-audit
```

**CLAUDE DOES:** Asks you 5 questions about your project type, scale, constraints, and any existing stack preferences. Then recommends a stack and writes `docs/stack-decision-record.md`.

**GATE — YOU REVIEW:**
- [ ] Does the recommended stack match what you had in mind?
- [ ] Any constraints Claude missed (budget, existing infra, team skills)?
- [ ] Is the homelab compatibility clear (does this need Docker, PM2, a Cloudflare tunnel entry)?
- [ ] Are you comfortable with all the choices?

**APPROVE** → Claude locks the stack in `project-spec.md`. Don't change it mid-build without a new `/stack-audit`.

---

### 0.3 — Fill in CLAUDE.md

**YOU DO:** Open `CLAUDE.md` and fill in the placeholders:
- Project name and goal
- Current milestone (start at Milestone 1)
- Design/UX guidelines (style, component library, CSS framework)

This takes 10 minutes. It's the most important 10 minutes of the project — everything Claude does in future sessions is anchored here.

**GATE:**
- [ ] Does CLAUDE.md clearly describe what you're building and why?
- [ ] Is the tech stack (from the stack audit) reflected here?

---

### 0.4 — Set Up Your Environment

**YOU DO:**
1. Create GitHub repo and push:
   ```bash
   gh repo create [project-name] --private && git remote add origin [url] && git push -u origin main
   ```
2. Create `.env` from the template (Claude will generate `.env.example` during setup)
3. Provision infrastructure:
   - [ ] Database (Supabase project, or PostgreSQL on homelab)
   - [ ] Hosting (Vercel project, or PM2 slot on homelab)
   - [ ] Auth provider (Supabase Auth, Better Auth, etc.)
   - [ ] Any external APIs (get keys, add to `.env`)

**GATE:**
- [ ] All services provisioned
- [ ] `.env` has all keys filled
- [ ] `.env` is gitignored (check `.gitignore`)
- [ ] GitHub repo is live
- [ ] Can run `npm install` (or `pnpm install`) without errors

---

# PHASE 1: PLAN
*One time per project, before any code.*

---

### 1.1 — Write the PRD

**YOU DO:** Open `prd.md`. Fill in:
- Problem statement (what pain are you solving?)
- Target users (be specific — not "everyone")
- Goals and non-goals
- User stories (P0/P1/P2)
- Success metrics (how will you know it worked?)

This is YOUR document. Claude can help draft it if you give it your raw notes, but you must own the decisions here.

**CLAUDE DOES** (optional): If you have rough notes, paste them and ask Claude to structure them into the PRD template. Review every word — Claude doesn't know your users like you do.

**GATE:**
- [ ] Is the problem statement specific and real?
- [ ] Are the success metrics measurable (not vague like "it feels fast")?
- [ ] Are the non-goals explicit? (This prevents scope creep later.)
- [ ] P0 features are the only ones required for MVP — is that list short enough?

---

### 1.2 — Write the Project Spec

**YOU DO:** Open `project-spec.md`. The tech stack section should already be filled from the stack audit. Add:
- System architecture overview (how the pieces connect)
- Database schema draft (main data models)
- API design (key endpoints if applicable)
- Infrastructure checklist (provision these before building)

**CLAUDE DOES:** Ask Claude to review your architecture section and flag any structural issues. Prompt: *"Review my architecture section for gaps, circular dependencies, or security concerns."*

**GATE:**
- [ ] All infrastructure items in the checklist are provisioned
- [ ] Database schema covers all P0 features
- [ ] Architecture has no obvious single points of failure
- [ ] Approved to start building

---

### 1.3 — Create GitHub Issues

**YOU DO:** Run:
```
/create-issues
```

**CLAUDE DOES:** Reads your spec and breaks it into GitHub issues per feature, with labels and milestone assignments.

**YOU DO:** Review the issues on GitHub. Edit titles or descriptions that don't make sense. Close any that are out of scope for Milestone 1.

**GATE:**
- [ ] GitHub issues created for all Milestone 1 features
- [ ] Issues are specific enough for Codex to execute (not vague like "add auth")
- [ ] Milestone 1 scope feels achievable

---

# PHASE 2: BUILD
*Repeat this loop for every feature. This is your main working cycle.*

---

## Feature Loop (repeat per feature)

---

### 2.1 — Start a Feature Session

**YOU DO:** Open Claude Code in your project folder. Run:
```
/vibe-code
```

**CLAUDE DOES:** Reads project context, summarizes where you left off, asks what you're working on today.

**YOU DO:** Tell Claude which feature you're starting (reference the GitHub issue number if you have one).

---

### 2.2 — Spec the Feature

**CLAUDE DOES:** Drafts `docs/specs/[feature-name]/spec.md` with:
- Problem / goal
- Success criteria (testable)
- Non-goals

**GATE — YOU REVIEW:**
- [ ] Does the spec match the GitHub issue / PRD requirement?
- [ ] Are the success criteria specific enough to test?
- [ ] Are non-goals explicit? (Prevents Claude from over-building)
- [ ] For Heavy Mode: is the threat model section addressed?

**APPROVE** → Tell Claude "spec approved, move to plan."

---

### 2.3 — Approve the Plan

**CLAUDE DOES:** Drafts `docs/specs/[feature-name]/plan.md` with:
- Files to create/modify
- Numbered slices (each with a clear deliverable)
- For Heavy Mode: which threats each slice addresses

**GATE — YOU REVIEW:**
- [ ] Does the plan cover all success criteria from the spec?
- [ ] Are slices small enough? (Each should take 1-3 hours of AI coding time)
- [ ] Does the slice order make sense? (Backend before frontend, schema before API)
- [ ] Any files being touched that seem unexpected or risky?

**APPROVE** → Tell Claude "plan approved, give me Slice 1."

---

### 2.4 — Execute Each Slice (Codex)

**CLAUDE DOES:** Produces a Codex task card for Slice 1:
```
Task: [slice description]
Files to create/modify: [list]
Success criteria: [what must be true when done]
Verification: [commands to run]
```

**YOU DO:**
1. Copy the task card into Codex
2. Codex writes the code
3. Run the verification commands:
   ```bash
   pnpm typecheck    # TypeScript must compile
   pnpm lint         # No lint errors
   pnpm test         # Tests must pass
   ```
4. Do a quick visual check if it's a UI change

**GATE — YOU VERIFY (per slice):**
- [ ] TypeScript compiles (no errors)
- [ ] Lint passes
- [ ] Tests pass for this slice
- [ ] Behavior matches the spec's success criteria
- [ ] No `console.log` or hardcoded secrets left in

**APPROVE** → Tell Claude "Slice 1 done, give me Slice 2." Repeat until all slices complete.

---

### 2.5 — Security Review (Heavy Mode only)

**CLAUDE DOES:** Runs through the OWASP Top 10 and validates the threat model mitigations are implemented. Uses `.ai/prompts/security-reviewer.md`.

**GATE — YOU REVIEW:**
- [ ] No critical or high issues flagged
- [ ] All threat model mitigations marked ✅ implemented
- [ ] Secrets audit passed
- [ ] Auth/authz verified (if applicable)

**If issues flagged:** Don't merge. Fix, then re-run the security review.

---

### 2.6 — Verify & Close the Feature

**CLAUDE DOES:** Runs through `docs/verification-template.md`:
- All automated gates (typecheck, lint, tests, build)
- Manual smoke test steps
- Security checklist (Heavy Mode)

**YOU DO:**
1. Follow the smoke test steps manually
2. Confirm the feature works end-to-end

**GATE — YOU VERIFY:**
- [ ] Smoke test complete
- [ ] Feature behaves as described in the spec
- [ ] No regressions in existing functionality
- [ ] Ready to commit

**APPROVE** → Claude provides the commit message. You commit:
```bash
git add [specific files]
git commit -m "feat(scope): description"
git push origin feature/[name]
# Then open a PR on GitHub
```

---

### 2.7 — Update Docs

**YOU DO:** Run:
```
/update-docs
```

**CLAUDE DOES:** Updates `architecture.md`, `changelog.md`, and `project-status.md` to reflect what was built. Commits with `docs: update project documentation`.

**YOU DO:** Glance at the updates. Make sure "Where We Left Off" is correct for next session.

---

### 2.8 — Repeat

Go back to 2.1 for the next feature. Repeat until Milestone 1 is complete.

---

# PHASE 3: MILESTONE REVIEW
*Do this when all Milestone features are done. Before starting the next milestone.*

---

### 3.1 — Run the Retro

**YOU DO:** Run:
```
/retro
```

**CLAUDE DOES:** Reviews what was built, what went well, what was slow or frustrating, and proposes improvements to `CLAUDE.md` and the workflow.

**YOU DO:** Read the retro findings. Accept or reject each proposed change to `CLAUDE.md`. Add your own observations.

**GATE:**
- [ ] CLAUDE.md improved with lessons from this milestone
- [ ] Any recurring mistakes have been encoded as rules
- [ ] Any workflow friction has been addressed

---

### 3.2 — Demo / Validate

**YOU DO:** Actually use the product. Get feedback from a real user if possible.
- Does it solve the problem?
- What's missing for real use?
- What surprised you?

**GATE:**
- [ ] Milestone 1 success metrics checked (from PRD)
- [ ] Decision made: continue to Milestone 2, pivot, or stop?

---

### 3.3 — Plan Next Milestone

**YOU DO:** Update `project-spec.md` with Milestone 2 features based on what you learned.

**CLAUDE DOES:** Run `/create-issues` to turn Milestone 2 into GitHub issues.

**GATE:**
- [ ] Milestone 2 scope defined
- [ ] Issues created and triaged

---

# PHASE 4: SHIP
*When you're ready to release publicly or to real users.*

---

### 4.1 — Pre-Ship Checklist

**YOU DO:**
- [ ] All P0 features from the PRD are working
- [ ] Security review completed for all Heavy Mode features
- [ ] No hardcoded secrets anywhere (`grep -r "sk_" .`)
- [ ] `.env.example` is up to date
- [ ] Error messages don't leak stack traces to users
- [ ] Rate limiting exists on public endpoints
- [ ] Database backups are configured (Supabase auto-backups are enabled)

**CLAUDE DOES:** Run a final security pass across the codebase using `.ai/prompts/security-reviewer.md`.

**GATE:**
- [ ] No open critical or high security issues
- [ ] Pre-ship checklist complete

---

### 4.2 — Deploy

**YOU DO:** Deploy to production environment:
- Vercel (frontend): `vercel --prod` or automatic on merge to main
- Homelab (backend): `git pull && pnpm build && pm2 restart [app-name]`

Verify the deployment is live:
- [ ] App loads without errors
- [ ] Auth flow works on production
- [ ] No environment variable missing (check logs)

---

### 4.3 — Monitor

**YOU DO:** Set up these minimums before calling it shipped:
- [ ] Sentry (or equivalent) is receiving errors
- [ ] You can see logs (PM2 logs / Vercel log drain)
- [ ] At least one uptime check is running

---

# QUICK REFERENCE

## Skill Commands

| Command | When to Use |
|---------|------------|
| `/stack-audit` | Before starting a project — validate your stack |
| `/vibe-code` | Start of every feature session |
| `/update-docs` | After each feature — sync all docs |
| `/create-issues` | After planning — convert spec to GitHub issues |
| `/retro` | End of each milestone — improve the workflow |

## Your Gates (Never Skip These)

| Gate | Phase | What You're Approving |
|------|-------|----------------------|
| Stack approval | Phase 0 | Tech stack is locked |
| PRD approval | Phase 1 | Problem, users, success criteria defined |
| Spec approval | Per feature | What we're building and success criteria |
| Plan approval | Per feature | How we're building it, slice sequence |
| Slice approval | Per slice | Code passes typecheck + lint + tests + manual check |
| Security approval | Heavy Mode | No critical/high issues before merge |
| Verification | Per feature | Smoke test done, feature works end-to-end |
| Milestone review | Per milestone | Retro done, next steps clear |

## Mode Selection Cheat Sheet

| Feature type | Mode |
|---|---|
| UI tweaks, copy changes, small components | Light |
| New page, new endpoint, CRUD feature | Heavy |
| Auth, roles, permissions | Heavy |
| Payments, financial data | Heavy |
| File uploads, webhooks | Heavy |
| AI/LLM integrations | Heavy |
| Scripts, automation, CLI tools | Light |

## Human vs AI Responsibility

| Decision | Owner |
|----------|-------|
| What to build (PRD, scope) | YOU |
| Tech stack choice | YOU (with /stack-audit) |
| Spec approval | YOU |
| Plan approval | YOU |
| Slice-level code review | YOU (run the gates) |
| Security judgment calls | YOU (Claude flags, you decide) |
| Write the code | Codex |
| Draft specs and plans | Claude |
| Security review | Claude |
| Doc maintenance | Claude |
| Commit messages | Claude (you confirm) |

---

> The speed of vibe coding comes from AI handling implementation.
> The quality comes from YOU staying in the loop at every decision point.
> Don't skip the gates — they exist because ~45% of AI-generated code has security issues.
