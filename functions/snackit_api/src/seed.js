'use strict'
// Demo data for local development, matching the web app's sample data.
const { batchKey, stockKey } = require('./schema')

const batches = [
  ['SNK-001', 'B-2611-A', '2027-02-15', 400], ['SNK-001', 'B-2612-B', '2027-04-30', 600],
  ['SNK-002', 'B-2611-C', '2027-01-20', 300], ['SNK-003', 'B-2611-D', '2027-03-10', 150],
  ['BEV-001', 'B-2611-E', '2027-05-01', 500], ['BEV-002', 'B-2611-F', '2027-01-05', 200],
  ['BEV-003', 'B-2611-G', '2027-09-30', 800], ['CHO-001', 'B-2611-H', '2027-06-15', 250],
  ['CHO-002', 'B-2611-I', '2027-08-01', 500],
].map(([sku, batch_no, expiry, qty]) => ({ batch_key: batchKey(sku, batch_no), sku, batch_no, expiry, qty, zoho_batch_id: '' }))

const stock = [
  ['VM-001', 'SNK-001', 'B-2611-A', 20], ['VM-001', 'BEV-001', 'B-2611-E', 12],
  ['VM-002', 'SNK-003', 'B-2611-D', 8], ['VM-003', 'BEV-003', 'B-2611-G', 30],
].map(([machine_code, sku, batch_no, qty]) => ({ stock_key: stockKey(machine_code, sku, batch_no), machine_code, sku, batch_no, qty }))

module.exports = {
  machines: [
    ['VM-001', 'Vending Machine 1', 'Tech Park Tower A', 'Whitefield', 'Ravi', 'ravi@example.com'],
    ['VM-002', 'Vending Machine 2', 'Tech Park Tower B', 'Whitefield', 'Ravi', 'ravi@example.com'],
    ['VM-003', 'Vending Machine 3', 'City Hospital Lobby', 'Indiranagar', 'Anita', 'anita@example.com'],
    ['VM-004', 'Vending Machine 4', 'University Block C', 'Koramangala', 'Anita', 'anita@example.com'],
    ['VM-005', 'Vending Machine 5', 'Metro Station East', 'MG Road', 'Suresh', 'suresh@example.com'],
  ].map(([machine_code, name, location, area, custodian, staff_emails]) => ({ machine_code, name, location, area, custodian, staff_emails, active: true })),
  items: [
    ['SNK-001', 'Salted Chips 50g', 'Snacks', 'Chips', 14, 20], ['SNK-002', 'Peanut Chikki', 'Snacks', 'Healthy', 8, 15],
    ['SNK-003', 'Protein Bar', 'Snacks', 'Healthy', 45, 80], ['BEV-001', 'Cola 250ml', 'Beverages', 'Soft Drinks', 16, 25],
    ['BEV-002', 'Cold Coffee 200ml', 'Beverages', 'Coffee', 28, 55], ['BEV-003', 'Mineral Water 500ml', 'Beverages', 'Water', 6, 10],
    ['CHO-001', 'Dark Chocolate 40g', 'Confectionery', 'Chocolate', 30, 60], ['CHO-002', 'Mint Candy Pack', 'Confectionery', 'Candy', 5, 8],
  ].map(([sku, name, category, subcategory, cost, price]) => ({ sku, name, category, subcategory, barcode: '', cost, price, zoho_item_id: '' })),
  vendors: [
    { vendor_code: 'V-001', name: 'Crunchy Foods Pvt Ltd', contact: 'Meena', phone: '9800000001', email: 'orders@crunchyfoods.example', gstin: '29AAAAA0000A1Z5', zoho_vendor_id: '', active: true },
    { vendor_code: 'V-002', name: 'FreshSip Beverages', contact: 'Arjun', phone: '9800000002', email: 'sales@freshsip.example', gstin: '29BBBBB1111B1Z6', zoho_vendor_id: '', active: true },
  ],
  batches,
  machine_stock: stock,
}
