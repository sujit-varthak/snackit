import type { DbState } from './types'

// Demo data so the UI is usable before real Zoho/Catalyst data is connected.
export const seed: DbState = {
  vendors: [
    { id: 'V-001', name: 'Crunchy Foods Pvt Ltd', contact: 'Meena', phone: '9800000001', email: 'orders@crunchyfoods.example', gstin: '29AAAAA0000A1Z5', active: true },
    { id: 'V-002', name: 'FreshSip Beverages', contact: 'Arjun', phone: '9800000002', email: 'sales@freshsip.example', gstin: '29BBBBB1111B1Z6', active: true },
  ],
  purchaseOrders: [],
  machines: [
    { id: 'VM-001', name: 'Vending Machine 1', location: 'Tech Park Tower A', area: 'Whitefield', custodian: 'Ravi' },
    { id: 'VM-002', name: 'Vending Machine 2', location: 'Tech Park Tower B', area: 'Whitefield', custodian: 'Ravi' },
    { id: 'VM-003', name: 'Vending Machine 3', location: 'City Hospital Lobby', area: 'Indiranagar', custodian: 'Anita' },
    { id: 'VM-004', name: 'Vending Machine 4', location: 'University Block C', area: 'Koramangala', custodian: 'Anita' },
    { id: 'VM-005', name: 'Vending Machine 5', location: 'Metro Station East', area: 'MG Road', custodian: 'Suresh' },
  ],
  items: [
    { sku: 'SNK-001', name: 'Salted Chips 50g', category: 'Snacks', subcategory: 'Chips', cost: 14, price: 20 },
    { sku: 'SNK-002', name: 'Peanut Chikki', category: 'Snacks', subcategory: 'Healthy', cost: 8, price: 15 },
    { sku: 'SNK-003', name: 'Protein Bar', category: 'Snacks', subcategory: 'Healthy', cost: 45, price: 80 },
    { sku: 'BEV-001', name: 'Cola 250ml', category: 'Beverages', subcategory: 'Soft Drinks', cost: 16, price: 25 },
    { sku: 'BEV-002', name: 'Cold Coffee 200ml', category: 'Beverages', subcategory: 'Coffee', cost: 28, price: 55 },
    { sku: 'BEV-003', name: 'Mineral Water 500ml', category: 'Beverages', subcategory: 'Water', cost: 6, price: 10 },
    { sku: 'CHO-001', name: 'Dark Chocolate 40g', category: 'Confectionery', subcategory: 'Chocolate', cost: 30, price: 60 },
    { sku: 'CHO-002', name: 'Mint Candy Pack', category: 'Confectionery', subcategory: 'Candy', cost: 5, price: 8 },
  ],
  batches: [
    { batchNo: 'B-2611-A', sku: 'SNK-001', expiry: '2027-02-15', qty: 400 },
    { batchNo: 'B-2612-B', sku: 'SNK-001', expiry: '2027-04-30', qty: 600 },
    { batchNo: 'B-2611-C', sku: 'SNK-002', expiry: '2027-01-20', qty: 300 },
    { batchNo: 'B-2611-D', sku: 'SNK-003', expiry: '2027-03-10', qty: 150 },
    { batchNo: 'B-2611-E', sku: 'BEV-001', expiry: '2027-05-01', qty: 500 },
    { batchNo: 'B-2611-F', sku: 'BEV-002', expiry: '2027-01-05', qty: 200 },
    { batchNo: 'B-2611-G', sku: 'BEV-003', expiry: '2027-09-30', qty: 800 },
    { batchNo: 'B-2611-H', sku: 'CHO-001', expiry: '2027-06-15', qty: 250 },
    { batchNo: 'B-2611-I', sku: 'CHO-002', expiry: '2027-08-01', qty: 500 },
  ],
  machineStock: [
    { machineId: 'VM-001', sku: 'SNK-001', batchNo: 'B-2611-A', qty: 20 },
    { machineId: 'VM-001', sku: 'BEV-001', batchNo: 'B-2611-E', qty: 12 },
    { machineId: 'VM-002', sku: 'SNK-003', batchNo: 'B-2611-D', qty: 8 },
    { machineId: 'VM-003', sku: 'BEV-003', batchNo: 'B-2611-G', qty: 30 },
  ],
  transfers: [],
  consumption: [],
}
