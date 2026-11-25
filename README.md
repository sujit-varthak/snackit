# Snackit – Vending Stock (Zoho Catalyst)

React (Vite) + TypeScript web app, hosted on Zoho Catalyst client hosting, with a Node function for Zoho Books API calls.
Next.js was not used: Catalyst client hosting is static only (no SSR).

## Layout
- `app/` – source. `npm run dev` for local dev; `npm run build` outputs the committed static site to `web/` (Slate, Static framework, Root Path `web`). `npm run build:cli` outputs to `../client` for `catalyst deploy`.
- `client/` – generated build + `client-package.json` (git-ignored).
- `functions/snackit_api/` – Advanced I/O (Express) function; Zoho integration stubs.
- `catalyst.json` – project config. Run `catalyst init` (or `catalyst login`) once to link the Catalyst project, then `catalyst deploy`.

## Status
Includes a vendor module (vendors, purchase orders, goods receipt with batch/expiry into head-office stock).
Working with local demo data (localStorage): stock dashboard, machines, transfer orders (batch select, high-margin suggestions),
consumption upload (xlsx/csv) with Zoho-ready download. Zoho sync is a stub.

## Open items from the 23 Nov MOM
- Real high-margin rule (`web/src/margin.ts`), Zoho machine lookup field name (`web/src/zoho.ts`), consumption Excel layout.
- Zoho Books credentials / environment (starting on Bharath's environment).
- Persistence: replace `web/src/store.ts` internals with Catalyst Data Store.
- Zoho Books migration is handled by someone else (via Manju) – out of scope here.

## Run locally (Slice 1: transfers and stock on the function)
1. `cd functions/snackit_api && npm install && npm start` (function on http://localhost:3100, local demo data in `.local-data.json`).
2. `cd app && npm install && npm run dev` (app on http://localhost:5173; `/api` is proxied to the function).
3. Sign in as Admin, Manager or Field staff with the selector at the bottom of the sidebar (local stand-in for Catalyst login).
4. Tests: `cd functions/snackit_api && npm test`.

The committed `web/` folder (what Slate serves) is the older demo build and is not rebuilt until the function is deployed. Consumption, vendors and purchase orders still use device-only demo data until the next slice.

## Buy and receive (purchase orders, receipts, Zoho)
Create a purchase order, receive it with batch and expiry, and see head-office stock against Zoho on the dashboard.
Zoho runs in **simulated** mode by default (a stand-in inside the function), so every step works without credentials.
For the real Zoho set `ZOHO_MODE=live` and `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID` (optional `ZOHO_DC`, `ZOHO_INVENTORY_ORG_ID`). The live client is not yet tested against a real organisation.
