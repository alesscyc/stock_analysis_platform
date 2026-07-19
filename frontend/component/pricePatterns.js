import { detectDoubleBottoms, detectDoubleTops } from './doubleReversal'

export { detectDoubleBottoms, detectDoubleTops } from './doubleReversal'

const PRICE_PATTERN_DETECTORS = [
  detectDoubleBottoms,
  detectDoubleTops,
]

export function detectPricePatterns(data, options) {
  return PRICE_PATTERN_DETECTORS
    .flatMap(detect => detect(data, options))
    .sort((a, b) => a.startIndex - b.startIndex)
}
