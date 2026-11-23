import type { TransferOrder } from './types'

// Shape of what Catalyst will send to Zoho Books (via a Catalyst Function – never call Zoho from the browser).
// Per MOM: Zoho only sees "head office -> vending machine" plus a custom field identifying the machine.
export const ZOHO_FROM_LOCATION = 'Head Office'
export const ZOHO_TO_LOCATION = 'Vending Machine' // the single consolidated location
export const ZOHO_MACHINE_CUSTOM_FIELD = 'cf_vending_machine' // TODO: confirm field/module name with Zoho admin

export function buildZohoTransferPayload(t: TransferOrder) {
  return {
    date: t.date,
    from_location: ZOHO_FROM_LOCATION,
    to_location: ZOHO_TO_LOCATION,
    custom_fields: [{ api_name: ZOHO_MACHINE_CUSTOM_FIELD, value: t.machineId }],
    line_items: t.lines.map((l) => ({ sku: l.sku, quantity_transfer: l.qty, batches: [{ batch_number: l.batchNo, quantity: l.qty }] })),
    reference_number: t.id,
  }
}

/** Placeholder until the Catalyst function + Zoho OAuth are wired up. */
export async function syncTransferToZoho(t: TransferOrder): Promise<{ ref: string }> {
  await new Promise((r) => setTimeout(r, 400))
  return { ref: `ZB-DEMO-${t.id}` }
}
