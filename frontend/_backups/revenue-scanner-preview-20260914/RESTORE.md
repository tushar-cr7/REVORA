# Revenue Scanner preview — rollback backup

Taken 2026-09-14, before the "holy-shit revenue scanning experience"
redesign. This is the exact known-good version of Revenue Scanner the
user was using as the fallback: functional (Run Scan / Run Intelligence
Pass / KPI cards / leak breakdown) but presented as a conventional SaaS
analytics page.

## To restore ("NAHH — RESTORE")

Copy the file below back to its original path, overwriting the preview.

| Backup path | Restore to |
|---|---|
| `app/(dashboard)/revenue-scanner/page.tsx` | `frontend/app/(dashboard)/revenue-scanner/page.tsx` |

Then delete the new component files the redesign added (safe to remove
once the file above is restored, since nothing else imports them):

- `frontend/components/scanner/` (entire directory)

This route had no other dedicated components before the redesign — the
single file above is a complete rollback.
