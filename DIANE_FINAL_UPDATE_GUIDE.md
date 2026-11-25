# DIANE Clothing Shop — Consolidated VS Code Update

## Before opening

1. Keep your current DIANE VS Code folder unchanged as a backup.
2. Extract this ZIP into a new folder, for example `DIANE_FINAL_UPDATE`.
3. Open the extracted folder in VS Code.
4. In the project terminal run:

```powershell
pnpm install
pnpm dev
```

For a production bundle, run:

```powershell
pnpm build
```

## Supabase connection

This project continues to use the Supabase URL and public key in `utils/supabase/info.tsx` or the `VITE_SUPABASE_URL` / `VITE_SUPABASE_ANON_KEY` environment variables. Do not put a service-role key in Vite environment variables or frontend code.

The project does not create a new Supabase project, table, or migration.

## One-time Admin Rider Management deployment

To create, edit, activate, and deactivate rider Auth accounts securely, deploy `supabase/functions/admin-riders/index.ts` to the same existing Supabase project. The existing project reference is in `supabase/config.toml`. Run `supabase login` then `supabase functions deploy admin-riders --project-ref uudsfidmqmtioahmxuve` from the project root. The function must have its standard Supabase server-side environment variables, including `SUPABASE_SERVICE_ROLE_KEY`, available at runtime. Never put the service-role key in frontend code.

Until the function is deployed, the Riders page will show an actionable Supabase function error when an account operation is attempted. The rest of the app can still be previewed.

## Important limitations

- Cart colour is browser-side only until an approved schema migration adds a colour field to the current cart/order item records.
- GCash/Maya is a school-project demo payment flow, not a real payment gateway.
- Back/side product images must be separately uploaded to the relevant products; unavailable views are intentionally not duplicated.
- Live camera requires `localhost` or HTTPS. An HTTP LAN address such as `http://192.168.x.x:8443` is not a secure camera context.
- Review history currently shows products the existing eligibility RPC confirms were reviewed. The current project does not provide a user-specific review-history RPC for actual private comment rows.

See `docs/FINAL_UPDATE_NOTES.md` for the details and items requiring live Supabase / camera verification.
