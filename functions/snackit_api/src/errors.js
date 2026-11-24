'use strict'
// One error shape for every failure: { error: { code, message, details } } (data contract section 4).
const STATUS = {
  NOT_FOUND: 404,
  NOT_ALLOWED: 403,
  INVALID_INPUT: 400,
  BATCH_SHORT: 409,
  STOCK_SHORT: 409,
  DUPLICATE: 409,
  ZOHO_ERROR: 502,
}

class AppError extends Error {
  constructor(code, message, details = {}) {
    super(message)
    this.code = code
    this.details = details
    this.status = STATUS[code] || 500
  }
}

module.exports = { AppError }
