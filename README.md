# Snackit – Vending Stock (Zoho Catalyst)

React (Vite) + TypeScript web app, hosted on Zoho Catalyst client hosting, with a Node function for Zoho Books API calls.
Next.js was not used: Catalyst client hosting is static only (no SSR).

## Layout
- `web/` – source. `npm run dev` for local dev; `npm run build` outputs to `web/dist` (Slate). `npm run build:cli` outputs to `../client` for `catalyst deploy`.
- `client/` – generated build + `client-package.json` (git-ignored).
- `functions/snackit_api/` – Advanced I/O (Express) function; Zoho integration stubs.
- `catalyst.json` – project config. Run `catalyst init` (or `catalyst login`) once to link the Catalyst project, then `catalyst deploy`.

## Status
Working with local demo data (localStorage): stock dashboard, machines, transfer orders (batch select, high-margin suggestions),
consumption upload (xlsx/csv) with Zoho-ready download. Zoho sync is a stub.

## Open items from the 23 Nov MOM
- Real high-margin rule (`web/src/margin.ts`), Zoho machine lookup field name (`web/src/zoho.ts`), consumption Excel layout.
- Zoho Books credentials / environment (starting on Bharath's environment).
- Persistence: replace `web/src/store.ts` internals with Catalyst Data Store.
- Zoho Books migration is handled by someone else (via Manju) – out of scope here.
