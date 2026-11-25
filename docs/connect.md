# Connecting to Zoho Books and to the Catalyst tables

Two separate connections. Do Zoho first on your own machine (it changes nothing), then deploy.

## 1. Zoho Books (and Inventory)

1. Open the Zoho API console for your data centre (India: https://api-console.zoho.in), create a **Self Client**, and note its client id and secret.
2. In the Self Client, **Generate Code** with these read-only scopes, for the organisation you want to read:
   `ZohoBooks.settings.READ,ZohoBooks.contacts.READ,ZohoInventory.items.READ`
   If the check below says items are not authorised, add `ZohoBooks.items.READ`.
   Sending purchase orders and receipts later also needs `ZohoBooks.contacts.CREATE`, `ZohoBooks.purchaseorders.READ`, `ZohoBooks.purchaseorders.CREATE` and the Inventory purchase-receive create scope (VERIFY its name on Zoho's page).
3. Within a few minutes, exchange the code for a refresh token (PowerShell; the three values come from the console):

```powershell
Invoke-RestMethod -Method Post -Uri "https://accounts.zoho.in/oauth/v2/token" -Body @{ grant_type = "authorization_code"; client_id = Read-Host "Client id"; client_secret = Read-Host "Client secret"; code = Read-Host "Code" } | Format-List
```

4. Copy `.env.example` to `.env` (repository root) and fill in the client id, secret, `refresh_token` from the answer, and the organisation id (Zoho Books → Settings → Organisation profile). git ignores `.env`, and it is outside the function folder, so a deploy does not upload it.
5. Check the connection. This only reads:

```powershell
cd functions/snackit_api; npm run zoho:check
```

It prints the locations, how many items and vendors it found, a few head-office batches, and the field names Zoho sent. Anything marked `FAIL`, or a count that looks wrong, means `src/zoho/live.js` needs adjusting before fetching.

6. Fetch into the app: `npm start` in `functions/snackit_api`, `npm run dev` in `app`, sign in as Admin, open **Fetch from Zoho**. With live Zoho the local data goes to `.local-data.live.json` and starts with the demo machines only.

A purchase order you create or receive while `ZOHO_MODE=live` **is sent to the real Zoho**. Use a test organisation until that part has been checked.

### What the fetch does

| What | Zoho call | Matched by | Taken from Zoho |
|---|---|---|---|
| Items | Books `GET /items` | SKU | name, category, barcode, cost, price, item id. Empty values do not overwrite ours |
| Vendors | Books `GET /contacts?contact_type=vendor` | Zoho id, or name the first time | name, contact, phone, email, GSTIN if present, active |
| Head-office batches | Inventory `GET /items/batches` per item | SKU and batch number | quantity at the head-office location, expiry, batch id |

- Nothing is deleted, and nothing is written to Zoho.
- App batch quantity = Zoho head-office quantity, less transfers and plus receipts that Zoho does not have yet.
- Rows that cannot be taken safely are listed on the screen with the reason.
- Zoho allows 100 calls a minute and a daily number by plan. Batches cost at least one call per item. If the limit is reached, what was fetched is kept; fetch again later.
- The dashboard's "app against Zoho" panel also reads batches for every item each time it opens. With a large item list that uses up the limit quickly.

### Exporting transfer orders to Zoho

Decided on 25 Nov 2026, following the 23 Nov meeting: Zoho has **one** location for all machines. Every exported transfer goes **Main warehouse → Vending Machine**, and the machine (VM-001, VM-002, ...) is written into a custom field on the transfer. Zoho's Destination dropdown only lists Zoho locations, so machines are not in that dropdown; they are in the field.

Set up Zoho once:

1. **Locations.** Zoho must have two locations: the main warehouse (already there) and one called **Vending Machine**. A transfer needs two different locations.
2. **Machine field.** Zoho Inventory → Settings → Preferences → Transfer Orders → Field Customization → New custom field, label **Vending Machine**.
   - *Dropdown*: Zoho users can pick and filter by machine, but every machine code must also be added as an option there. When you add a machine in the app, add its code to this dropdown too, or Zoho refuses the export and the app shows why.
   - *Text*: nothing to keep up; the app always fills it. Filtering works by search instead of a list.
3. **Field id.** Open the field and copy its id (or read it with the API); put it in `.env` as `ZOHO_MACHINE_FIELD_ID`.
4. **Scopes.** Add `ZohoInventory.transferorders.CREATE` and `ZohoInventory.transferorders.READ` to the Self Client and generate a new refresh token.
5. **Ids in the app.** Run **Fetch from Zoho** (items and batches) first: the export sends Zoho's item id and batch id, not our codes.

In the app: **Transfer Orders → Export to Zoho**. A failed export stays in the list with Zoho's reason and a **Retry export** button. An exported transfer is locked: it can no longer be edited or deleted here, because the two systems would then disagree. Correct it with a new transfer.

Not yet checked against a real Zoho (VERIFY on the first export, in a test organisation): finding an existing transfer by its number, sending our number with `ignore_auto_number_generation`, and whether Zoho books the transfer as done or *in transit*. If it is in transit, a "mark as received" step must be added before the Vending Machine location rises.

## 2. Catalyst tables

`catalyst-config.json` sets `STORE=catalyst`, so the deployed function reads and writes the nine tables (`catalyst-database.md`).

**Sign-in is not built yet, so the deployed API refuses every request.** To test on the Development environment, add the environment variable `DEV_AUTH=on` to the function in the Catalyst console. While it is on, anyone who has the function's address can act as admin, which includes sending orders to Zoho if live Zoho is configured. Turn it off after testing, and do not use it with real data.

1. Install the Catalyst CLI and sign in with the account that owns the Snack-it project:

```powershell
npm install -g zcatalyst-cli
```

```powershell
catalyst login
```

2. In the repository root, link the project (`catalyst project:use`). If any step offers to overwrite `catalyst.json` or the function folder, say no.
3. In the Catalyst console, add the function's environment variables: `ZOHO_MODE=live`, `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID`. Do not put them in `catalyst-config.json`, which is committed.
4. Build the web app and deploy:

```powershell
cd app; npm run build:cli; cd ..; catalyst deploy
```

5. Check, in this order. These have only been tested against stand-ins:
   - the console variables are still there after the deploy;
   - `/server/snackit_api/health` answers `{"ok":true}`;
   - adding a vendor in the app creates a row in the `vendors` table, and editing it changes that row;
   - **Fetch from Zoho** fills `items`, then `batches` (each batch linked to its item);
   - a transfer writes `transfers` and `machine_stock`.

The `machines` table starts empty and there is no screen to add machines yet: add rows in the Catalyst console (`machine_code`, `name`, `active`) or call `POST /api/machines`.
