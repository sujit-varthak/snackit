# Snackit – Vending Stock (Zoho Catalyst)

React (Vite) + TypeScript web app, hosted on Zoho Catalyst client hosting, with a Node function that holds the stock rules,
reads and writes the Catalyst tables and talks to Zoho.
Next.js was not used: Catalyst client hosting is static only (no SSR).

## Layout
- `app/` – source. `npm run dev` for local dev; `npm run build` outputs the committed static site to `web/` (Slate, Static framework, Root Path `web`). `npm run build:cli` outputs to `../client` for `catalyst deploy`.
- `client/` – generated build + `client-package.json` (git-ignored).
- `functions/snackit_api/` – Advanced I/O (Express) function: rules, Catalyst data adapter, Zoho clients (live and simulated).
- `catalyst.json` – project config. Run `catalyst init` (or `catalyst login`) once to link the Catalyst project, then `catalyst deploy`.
- `docs/` – `data-contract.md` (names and rules), `catalyst-database.md` (tables as created), `connect.md` (Zoho credentials and deploy).

## Status
- Every screen goes through the function: stock dashboard, machines, transfer orders, consumption upload, vendors, purchase orders. Nothing is kept in the browser except the chosen dev role.
- **Fetch from Zoho** (admin) copies items, vendors and head-office batches from Zoho into the app. Tested with the simulated Zoho and canned Zoho answers, **not yet against a real organisation**.
- The deployed function uses the Catalyst tables. **Not yet deployed or run inside Catalyst.**
- Not built: sign-in (the deployed API refuses requests until then, see `docs/connect.md`), sending transfers to Zoho, adding machines from the app.

## Open items from the 23 Nov MOM
- Real high-margin rule (`app/src/margin.ts`), Zoho machine lookup field name (`cf_vending_machine` is a placeholder), consumption Excel layout.
- Zoho Books credentials / environment (starting on Bharath's environment).
- Zoho Books migration is handled by someone else (via Manju) – out of scope here.

## Run locally
1. `cd functions/snackit_api && npm install && npm start` (function on http://localhost:3100, demo data in `.local-data.json`).
2. `cd app && npm install && npm run dev` (app on http://localhost:5173; `/api` is proxied to the function).
3. Sign in as Admin, Manager or Field staff with the selector at the bottom of the sidebar (local stand-in for Catalyst login).
4. Tests: `cd functions/snackit_api && npm test` (runs on the memory store and on the Catalyst adapter over a fake).

The committed `web/` folder (what Slate serves) is the older demo build and is not rebuilt until the function is deployed.

## Zoho
Zoho runs in **simulated** mode by default (a stand-in inside the function), so every step works without credentials.
For the real Zoho, copy `.env.example` to `.env`, fill it in, and run `npm run zoho:check` in `functions/snackit_api` (read only). Full steps: `docs/connect.md`.
With live Zoho, creating and receiving purchase orders writes to the real organisation.
