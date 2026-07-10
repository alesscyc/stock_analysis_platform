import { detectDoubleBottoms, detectDoubleTops } from './doubleReversal'

export { detectDoubleBottoms, detectDoubleTops } from './doubleReversal'

const PRICE_PATTERN_DETECTORS = [detectDoubleBottoms, detectDoubleTops]

export function detectPricePatterns(data) {
  return PRICE_PATTERN_DETECTORS
    .flatMap(detect => detect(data))
    .sort((a, b) => a.startIndex - b.startIndex)
}
