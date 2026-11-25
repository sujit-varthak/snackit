# Snackit data contract (v0.1, 24 Nov 2026)

One reference for the web app, the Catalyst function, the database and the Zoho mapping. Change a name here first, then in code.
Items marked **PLACEHOLDER** are waiting on a client answer. Items marked **VERIFY** come from Zoho's API pages as summarised and must be checked against the live page before coding.

## 1. Principles

1. **One owner per fact.** Zoho owns items, suppliers, head-office stock and batches, purchase orders, invoices and money. The app owns stock per machine, transfer history per machine, consumption reports, users and sync status.
2. **The browser never calls Zoho.** Only the Catalyst function does.
3. **Save first, sync second.** Every transfer and purchase order is saved in our database, marked `pending`, then sent to Zoho.
4. **Naming.** snake_case for tables, fields and JSON keys. Codes (`machine_code`, `sku`, `batch_no`) are strings. Dates are `YYYY-MM-DD`. Quantities are whole numbers. Money is a number with two decimals.
5. **Check that ties both sides:** for each item, the sum of `machine_stock.qty` across machines equals Zoho's quantity at the Vending Machine location.

## 2. Tables (lean design, 9 tables)

**Created in Catalyst on 25 Nov 2026.** The exact structure, table ids, links and the two renamed columns (`lines` is `line_items`, `invoiced` is `is_invoiced`) are in `catalyst-database.md`. The columns below are the app's names.

Catalyst adds `ROWID`, `CREATEDTIME`, `MODIFIEDTIME` to every table. Unique columns marked U.

| Table | Column | Type | Notes |
|---|---|---|---|
| machines | machine_code | string, U | for example VM-001; also the value sent to Zoho |
| | name, location, area, custodian | string | |
| | staff_emails | text | comma-separated emails of staff who may see the machine |
| | active | boolean | |
| items | sku | string, U | same SKU as Zoho |
| | name, category, subcategory, barcode | string | |
| | cost, price | number | |
| | zoho_item_id | string | |
| vendors | vendor_code | string, U | |
| | name, contact, phone, email, gstin | string | |
| | zoho_vendor_id | string | |
| | active | boolean | |
| batches | batch_key | string, U | `sku\|batch_no` |
| | sku, batch_no | string | |
| | expiry | date | |
| | qty | int | head-office quantity |
| | zoho_batch_id | string | Zoho needs this id on transfer lines |
| machine_stock | stock_key | string, U | `machine_code\|sku\|batch_no` |
| | machine_code, sku, batch_no | string | |
| | qty | int | never below 0 |
| transfers | transfer_no | string, U | TO-0001 |
| | machine_code | string | |
| | transfer_date | date | |
| | lines | text (JSON) | see section 3 |
| | zoho_sync | string | pending, synced, failed |
| | zoho_id, zoho_error | string | |
| consumption_reports | report_no | string, U | CR-0001 |
| | consumption_date | date | |
| | uploaded_by | string | |
| | lines | text (JSON) | see section 3 |
| purchase_orders | po_no | string, U | PO-0001 |
| | vendor_code | string | |
| | po_date | date | |
| | status | string | open, received |
| | lines, receipts | text (JSON) | see section 3 |
| | zoho_sync, zoho_id, zoho_error | string | order sent to Zoho: pending, synced, failed |
| | zoho_lines | text (JSON) | Zoho line item ids, needed to receive the order |
| | zoho_receipt_sync, zoho_receipt_id, zoho_receipt_error | string | receipt sent to Zoho |
| settings | setting_key | string, U | for example high_margin_threshold_pct |
| | setting_value | string | |

If the client's Catalyst plan allows more tables, `lines` and `receipts` can move to their own tables with no change to the API below.

## 3. JSON shapes

```json
// transfers.lines
[{ "sku": "SNK-001", "batch_no": "B-2611-A", "qty": 20 }]

// consumption_reports.lines
[{ "machine_code": "VM-001", "sku": "SNK-001", "qty": 4 }]

// purchase_orders.lines
[{ "sku": "SNK-001", "qty": 100, "rate": 14.0 }]

// purchase_orders.receipts
[{ "sku": "SNK-001", "batch_no": "B-2611-A", "expiry": "2027-02-15", "qty": 100 }]
```

## 4. Function API (all under `/api`)

Every call carries the Catalyst login. The function returns the user's role from the login, never from the request.
Errors use one shape: `{ "error": { "code": "BATCH_SHORT", "message": "Batch B-1 has 10 available (requested 20)", "details": {} } }`.
Codes: `NOT_FOUND`, `NOT_ALLOWED`, `INVALID_INPUT`, `BATCH_SHORT`, `STOCK_SHORT`, `DUPLICATE`, `ZOHO_ERROR`.

| Method and path | Role | Purpose |
|---|---|---|
| GET /me | any | Name, role, assigned machines |
| GET /machines | any | Machines the user may see |
| POST /machines, PUT /machines/:code | admin | Add or edit a machine |
| GET /items | any | Item list |
| GET /batches | manager, admin | Head-office batches |
| GET /stock?machine_code= | any | Machine stock, limited to the user's machines |
| POST /transfers | manager, admin | Create a transfer; body `{ machine_code, lines[] }` |
| GET /transfers | any | History, limited to the user's machines |
| POST /transfers/:no/sync | manager, admin | Send or resend to Zoho |
| POST /consumption/preview | any | Validate a file's rows; applies nothing |
| POST /consumption | any | Apply a day's report; body `{ consumption_date, lines[] }` |
| GET /consumption | any | Reports; `GET /consumption/:no/export` gives the Zoho file |
| GET /vendors, POST /vendors, PUT /vendors/:code | manager, admin | Vendors |
| POST /purchase-orders | manager, admin | Create, then send to Zoho. A Zoho failure is stored on the order, not returned as an error |
| POST /purchase-orders/:no/receive | manager, admin | Receive with batch and expiry, then send the receipt to Zoho (same rule) |
| GET /purchase-orders | manager, admin | List |
| POST /purchase-orders/:no/sync | manager, admin | Resend the order, and its receipt if received, to Zoho |
| GET /zoho/status | manager, admin | Is Zoho reachable, and which mode (simulated or live) |
| GET /zoho/head-office | manager, admin | Head-office batches: app quantity against Zoho quantity |
| POST /dev/zoho | manager, admin | Test switch that simulates a Zoho outage (simulated mode only) |
| POST /sync/items | admin | Pull items and batches from Zoho |
| GET /reconciliation | manager, admin | Items where machine total differs from Zoho |

## 5. Stock rules (the function enforces these)

1. A transfer line needs an existing batch with enough `batches.qty`. Otherwise `BATCH_SHORT`.
2. A transfer takes the quantity from `batches.qty` and adds it to `machine_stock`, in that order, in one function call. If the second step fails, the first is undone.
3. A consumption line reduces `machine_stock` earliest expiry first. If the machine holds less than the line, the whole file is refused with `STOCK_SHORT` and the rows named. Nothing is applied.
4. A consumption upload for a date that already has a report returns `DUPLICATE` unless the caller confirms.
5. A receipt requires a batch number and expiry on every received line, and adds to `batches`.
6. Saving a transfer or purchase order never waits on Zoho.

## 6. Zoho mapping

The transfer, batch and receive calls are **Zoho Inventory** (`/inventory/v1`). Items, locations, contacts and purchase orders are **Zoho Books** (`/books/v3`). Base domain for India is `zohoapis.in`. Every call carries `organization_id`. VERIFY whether Books and Inventory share one organisation id.

| App field | Zoho call and field | Notes |
|---|---|---|
| Items pull | Books `GET /items` | `item_id`, `sku` |
| Batches pull | Inventory `GET /items/batches?item_id=` | `batch_id`, `batch_number`, `expiry_date` |
| Locations | Books `GET /locations` | find Head Office and Vending Machine ids once |
| transfers | Inventory `POST /transferorders` | `date`, `from_location_id`, `to_location_id`, `line_items` |
| transfer line | `line_items[{ item_id, name, quantity_transfer, batches[{ batch_id, out_quantity }] }]` | needs `zoho_batch_id`; not batch number |
| transfer_no | `transfer_order_number` | **VERIFY** page marks it required and optional; do not rely on `reference_number` |
| machine_code | `custom_fields[{ customfield_id, value }]` | **PLACEHOLDER** field name `cf_vending_machine` |
| vendors | Books `POST /contacts` | `contact_name`, `contact_type: vendor`, `gst_no`, `gst_treatment` |
| purchase_orders | Books `POST /purchaseorders` | `vendor_id`, `line_items[{ item_id, rate, quantity, location_id }]` |
| receipts | Inventory `POST /purchasereceives?purchaseorder_id=` | `line_items[{ line_item_id, quantity, batches[{ batch_number, quantity_in, expiry_date }] }]`; `line_item_id` comes from the purchase order response |
| Consumption file | Finance upload to Zoho invoices | **VERIFY** Inventory invoices need `batch_id` per line; our file has none |

**Modes.** `ZOHO_MODE=live` calls the real Zoho and needs `ZOHO_CLIENT_ID`, `ZOHO_CLIENT_SECRET`, `ZOHO_REFRESH_TOKEN`, `ZOHO_ORG_ID` (optional `ZOHO_DC`, `ZOHO_INVENTORY_ORG_ID`). Anything else uses a simulated Zoho inside the function, so every flow can be run and tested without credentials. The live client is not yet tested against a real organisation.

Limits to design for: 100 calls a minute per organisation, a daily cap by plan (1,000 Free to 10,000 Premium and above), 5 to 10 calls at once. On HTTP 429 the function waits and retries.

## 7. Placeholders waiting on the client

| Item | Current value | Where it lives |
|---|---|---|
| Machine field on transfer orders | `cf_vending_machine` | one constant in the function |
| High-margin rule | margin of 40% or more | `settings.high_margin_threshold_pct` |
| Consumption file columns | Machine ID, SKU, Quantity | one parser file |
| Customer on consumption invoices | not set | open question |
| Who picks the batch on consumption invoices | not set | open question |
| Staff and their machines | not set | `machines.staff_emails` |

## 8. Change process

1. Change this file, with the reason in the commit message.
2. Update the table definitions file, the function, the app and the Zoho mapping together.
3. Run the rule tests and the reconciliation check before tagging a release.
