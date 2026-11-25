import type { ApiItem } from './api'

// TODO(MOM): "High-margin rule is already defined in Catalyst" – replace this placeholder
// with the real rule once the client shares it.
export const HIGH_MARGIN_THRESHOLD_PCT = 40

export const marginPct = (i: ApiItem) => (i.price > 0 ? ((i.price - i.cost) / i.price) * 100 : 0)
export const isHighMargin = (i: ApiItem) => marginPct(i) >= HIGH_MARGIN_THRESHOLD_PCT
