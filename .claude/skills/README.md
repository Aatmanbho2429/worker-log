# Project skills

- `scaffold-entity/` — a new entity end-to-end: Angular + Rust models, service,
  repo SQL, commands and registration.
- `supabase/` — the account/licence layer: auth, device binding, subscription
  plans, Razorpay, and an index of the `.claude/plans/` design notes.
- `extract-static-text/` — move hardcoded UI copy into `assets/i18n/en.json` and
  repeated non-text literals into `models/constants.ts`.

Add a project-specific skill here as `.claude/skills/<skill-name>/SKILL.md` when
a multi-step procedure in this repo gets pasted into chat more than once.

See https://code.claude.com/docs/en/skills for the frontmatter format
(`description`, `disable-model-invocation`, `paths`, etc.).

## Skills vs. rules vs. CLAUDE.md

- **`CLAUDE.md`** — the map only. In context every turn, so it stays short.
- **`.claude/rules/`** (sibling directory) — standing conventions that should
  just be in context whenever someone touches the matching files. Each carries
  a `paths:` glob and costs nothing until it matches. This is where detail
  belongs by default.
- **`.claude/skills/`** — a procedure you *invoke* to do a specific job.

When CLAUDE.md grows, the fix is to move the new material into a rule, not to
trim the prose.
