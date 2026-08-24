# v1, kept

These four files are the written record of the previous build — what was tried,
what broke in production, and what it cost to find out. They are copied here for
convenience.

**They are not the archive.** The archive is `Hussain2111/Trellis`, which still
exists, untouched, with its full history and all three branches. This build got
a new repository under a new name specifically so that one never had to be
renamed, emptied or deleted, and so that no file had to be correctly enumerated
in order to survive.

| File                    | What it holds                                           |
| ----------------------- | ------------------------------------------------------- |
| `v1-NOTES.md`           | Stage-by-stage build log, every bug found and why       |
| `v1-roadmap.md`         | The operational roadmap: Vercel, Supabase, GitHub, Meta |
| `v1-cutover.md`         | The v1→v2 migration checklist that was never run        |
| `v1-instagram-setup.md` | Token generation, scopes, the Page→IG_USER_ID path      |

The most expensive knowledge in the set is the scope list and the
`business_management` failure mode, which now lives in code at
`lib/graph/scopes.ts`.
