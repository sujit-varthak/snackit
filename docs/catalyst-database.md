# Catalyst database as created (25 Nov 2026)

Project Snack-it, Development environment, in the demo account. Nine tables, all empty. The table limit that blocked this earlier has been lifted.
This file records what exists. `data-contract.md` stays the source for field meaning; where the two differ, this file is what is really in Catalyst.

Catalyst adds `ROWID`, `CREATORID`, `CREATEDTIME` and `MODIFIEDTIME` to every table.

## How links work

A link column stores the parent row's `ROWID` (a big number), not the readable code. So every linked table keeps **both**:

- the readable code column (for example `machine_code`), which the app and the tests use everywhere;
- a link column (for example `machine_id`), which the database checks. It accepts only a real parent row and refuses anything else.

The Catalyst data adapter (not built yet) looks up the parent's `ROWID` by its code and fills the link column on every write.

| Child table | Link column | Points to | When the parent is deleted |
|---|---|---|---|
| batches | item_id | items | the batch is deleted too |
| machine_stock | machine_id | machines | the stock row is deleted too |
| machine_stock | batch_id | batches | the stock row is deleted too |
| transfers | machine_id | machines | link is emptied; history keeps `machine_code` |
| purchase_orders | vendor_id | vendors | link is emptied; history keeps `vendor_code` |

Tested with real rows on 25 Nov: a made-up id was refused, deleting an item removed its batch and stock, deleting a machine kept its transfer.
`consumption_reports` has no link: its machines and items are inside `line_items`.

## Tables

| Table | Table id | Columns (besides the Catalyst ones) |
|---|---|---|
| machines | 29680000000459476 | machine_code (unique), name, location, area, custodian, staff_emails (text), active |
| items | 29680000000458009 | sku (unique), name, category, subcategory, barcode, cost, price, zoho_item_id |
| vendors | 29680000000458368 | vendor_code (unique), name, contact, phone, email, gstin, zoho_vendor_id, active |
| batches | 29680000000463011 | batch_key (unique), sku, **item_id**, batch_no, expiry, qty, zoho_batch_id |
| machine_stock | 29680000000454007 | stock_key (unique), machine_code, sku, batch_no, qty, **machine_id**, **batch_id** |
| transfers | 29680000000453005 | transfer_no (unique), machine_code, transfer_date, line_items (text), zoho_sync, zoho_id, zoho_error, **machine_id** |
| consumption_reports | 29680000000467009 | report_no (unique), consumption_date, uploaded_by, line_items (text), is_invoiced |
| purchase_orders | 29680000000456005 | po_no (unique), vendor_code, po_date, status, line_items, receipts, zoho_lines (all text), zoho_sync, zoho_id, zoho_error, zoho_receipt_sync, zoho_receipt_id, zoho_receipt_error, **vendor_id** |
| settings | 29680000000450005 | setting_key (unique), setting_value |

Bold columns are the link columns.

## Differences from the data contract

| In the app and contract | In Catalyst | Why |
|---|---|---|
| `lines` | `line_items` | `lines` is a reserved word in the database |
| `invoiced` | `is_invoiced` | same kind of clash; the app field name stays `invoiced` |
| (none) | the five link columns above | enforced links, filled by the adapter |
| `settings.setting_value` up to 500 characters | 255 | Catalyst's limit for this column type |

The adapter maps the renamed columns in both directions, so the rules, the API and the 38 tests do not change.
JSON columns (`line_items`, `receipts`, `zoho_lines`) hold up to 10,000 characters each.

## The data adapter (`functions/snackit_api/src/store/catalyst.js`)

Set `STORE=catalyst` and the function reads and writes these tables instead of the local demo data. It does the renames, fills the link columns, stores JSON as text (refusing anything over 10,000 characters), converts numbers and booleans, and undoes a failed multi-step change by replaying the inverse steps (Catalyst has no transactions).

How it was checked:
- All 48 tests pass on both the memory store and the Catalyst adapter (`npm test` runs both). The adapter runs over a fake Catalyst that copies this real structure and refuses unknown columns, bad links and duplicate keys.
- The three ZCQL query forms the real client sends (match by value, value with an apostrophe, paged list) were run against the real tables and returned the shape the adapter expects.

Not checked: the Catalyst SDK calls themselves (`catalyst-sdk.js`), because they only run inside Catalyst. They are marked VERIFY for the first deploy.
