import type { Item } from './types'

// TODO(MOM): "High-margin rule is already defined in Catalyst" – replace this placeholder
// with the real rule once the client shares it.
export const HIGH_MARGIN_THRESHOLD_PCT = 40

export const marginPct = (i: Item) => (i.price > 0 ? ((i.price - i.cost) / i.price) * 100 : 0)
export const isHighMargin = (i: Item) => marginPct(i) >= HIGH_MARGIN_THRESHOLD_PCT
