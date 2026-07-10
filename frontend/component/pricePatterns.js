import { detectDoubleBottoms, detectDoubleTops } from './doubleReversal'
import { detectHeadAndShoulders } from './headAndShoulders'

export { detectDoubleBottoms, detectDoubleTops } from './doubleReversal'
export { detectHeadAndShoulders } from './headAndShoulders'

const PRICE_PATTERN_DETECTORS = [detectDoubleBottoms, detectDoubleTops, detectHeadAndShoulders]

export function detectPricePatterns(data) {
  return PRICE_PATTERN_DETECTORS
    .flatMap(detect => detect(data))
    .sort((a, b) => a.startIndex - b.startIndex)
}
