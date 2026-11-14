# AGENTS.md

- **Verify** an `app/` change before reporting it done: `npm run typecheck`, then `npm run test`.
- **Writing `app/` code** (loaders, actions, untrusted input, types, `~/db` imports): follow `CODING_STANDARDS.md`.
- **Naming** domain concepts in code, tests, or UI: use the terms in `CONTEXT.md`; check `docs/adr/` before changing a decided behaviour.
- **Database tests:** copy the setup in `app/routes/courses.$slug.test.ts`.
- **Issue tracker** (publishing a spec or ticket, fetching a ticket): follow `docs/agents/issue-tracker.md`.
