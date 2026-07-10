import { findPivotHighs, findPivotLows } from './doubleReversal'

export const DEFAULT_HEAD_AND_SHOULDERS_OPTIONS = {
  leftBars: 3,
  rightBars: 3,
  shoulderTolerance: 0.05,
  minHeadHeight: 0.03,
  minBarsBetweenPeaks: 5,
  maxBarsBetweenPeaks: 50,
}

const lowest = points => points.reduce((best, point) => (
  point.price < best.price ? point : best
))

export function detectHeadAndShoulders(data, options = {}) {
  if (!data?.length) return []

  const opts = { ...DEFAULT_HEAD_AND_SHOULDERS_OPTIONS, ...options }
  const highs = findPivotHighs(data, opts.leftBars, opts.rightBars)
  const lows = findPivotLows(data, opts.leftBars, opts.rightBars)
  const patterns = []

  for (let i = 1; i < highs.length - 2; i++) {
    const priorHigh = highs[i - 1]
    const leftShoulder = highs[i]
    const head = highs[i + 1]
    const rightShoulder = highs[i + 2]
    const leftSpacing = head.index - leftShoulder.index
    const rightSpacing = rightShoulder.index - head.index

    if (leftSpacing < opts.minBarsBetweenPeaks || leftSpacing > opts.maxBarsBetweenPeaks) continue
    if (rightSpacing < opts.minBarsBetweenPeaks || rightSpacing > opts.maxBarsBetweenPeaks) continue

    const shoulderHeight = Math.max(leftShoulder.price, rightShoulder.price)
    if (Math.abs(leftShoulder.price - rightShoulder.price) / shoulderHeight > opts.shoulderTolerance) continue
    if (head.price < shoulderHeight * (1 + opts.minHeadHeight)) continue

    const priorLows = lows.filter(low => low.index < leftShoulder.index)
    if (priorHigh.price >= leftShoulder.price || priorLows.length < 2) continue
    if (priorLows[priorLows.length - 2].price >= priorLows[priorLows.length - 1].price) continue

    const leftTroughs = lows.filter(low => low.index > leftShoulder.index && low.index < head.index)
    const rightTroughs = lows.filter(low => low.index > head.index && low.index < rightShoulder.index)
    if (!leftTroughs.length || !rightTroughs.length) continue

    const leftTrough = lowest(leftTroughs)
    const rightTrough = lowest(rightTroughs)
    const necklineSlope = (rightTrough.price - leftTrough.price) / (rightTrough.index - leftTrough.index)
    const necklineAt = index => leftTrough.price + necklineSlope * (index - leftTrough.index)
    let status = 'pending'
    let outcome

    for (let j = rightShoulder.index + 1; j < data.length; j++) {
      if (data[j].close < necklineAt(j)) {
        status = 'confirmed'
        outcome = data[j]
        break
      }
      if (data[j].close > head.price) {
        status = 'failed'
        outcome = data[j]
        break
      }
    }

    const necklineEnd = outcome ?? data[data.length - 1]
    patterns.push({
      id: `head-and-shoulders-${leftShoulder.index}-${head.index}-${rightShoulder.index}`,
      type: 'head-and-shoulders',
      status,
      startIndex: leftShoulder.index,
      color: '#ef5350',
      pendingColor: 'rgba(239, 83, 80, 0.55)',
      lines: [
        {
          points: [leftShoulder, leftTrough, head, rightTrough, rightShoulder],
          style: 'status',
          width: 2,
        },
        {
          points: [
            leftTrough,
            { time: necklineEnd.time, price: necklineAt(data.indexOf(necklineEnd)) },
          ],
          style: 'dashed',
          width: status === 'confirmed' ? 2 : 1.5,
          label: { key: 'patternNeckline', position: 'below' },
        },
      ],
      labels: [
        { point: leftShoulder, key: 'patternLeftShoulder', position: 'above' },
        { point: head, key: 'patternHead', position: 'above' },
        { point: rightShoulder, key: 'patternRightShoulder', position: 'above' },
      ],
      breakout: status === 'confirmed' ? outcome : undefined,
      invalidated: status === 'failed' ? outcome : undefined,
    })
  }

  return patterns
}
