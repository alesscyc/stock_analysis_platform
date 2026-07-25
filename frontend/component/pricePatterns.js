import { detectDoubleBottoms, detectDoubleTops } from './doubleReversal'
import { detectHeadShoulders, detectInverseHeadShoulders } from './headShoulders'

export { detectDoubleBottoms, detectDoubleTops } from './doubleReversal'
export { detectHeadShoulders, detectInverseHeadShoulders } from './headShoulders'

const PRICE_PATTERN_DETECTORS = [
  detectDoubleBottoms,
  detectDoubleTops,
  detectHeadShoulders,
  detectInverseHeadShoulders,
]

function patternSpan(p) {
  const pts = p.lines?.find(line => line.style === 'status')?.points
  if (pts?.length) {
    const idxs = pts.map(pt => pt.index).filter(i => Number.isFinite(i))
    if (idxs.length) return { start: Math.min(...idxs), end: Math.max(...idxs) }
  }
  return { start: p.startIndex ?? 0, end: p.startIndex ?? 0 }
}

function overlaps(a, b) {
  return a.start <= b.end && a.end >= b.start
}

/** Prefer confirmed, then pending, then failed; then shorter span. */
function patternScore(p) {
  const statusRank = p.status === 'confirmed' ? 0 : p.status === 'pending' ? 1 : 2
  const { start, end } = patternSpan(p)
  return statusRank * 1e6 + (end - start)
}

/** Cross-type: one winner per overlapping time span. */
export function dedupeOverlappingPatterns(patterns) {
  const ranked = [...patterns].sort((a, b) => {
    const diff = patternScore(a) - patternScore(b)
    return diff !== 0 ? diff : (a.startIndex ?? 0) - (b.startIndex ?? 0)
  })
  const kept = []
  for (const p of ranked) {
    const span = patternSpan(p)
    if (kept.some(k => overlaps(span, patternSpan(k)))) continue
    kept.push(p)
  }
  return kept.sort((a, b) => (a.startIndex ?? 0) - (b.startIndex ?? 0))
}

export function detectPricePatterns(data, options) {
  return dedupeOverlappingPatterns(
    PRICE_PATTERN_DETECTORS.flatMap(detect => detect(data, options)),
  )
}
