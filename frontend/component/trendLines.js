const storageKey = symbol => `stockai-trend-lines:${symbol.toUpperCase()}`

function isValidTime(time) {
  return typeof time === 'string'
    || (typeof time === 'number' && Number.isFinite(time))
    || (
      time !== null
      && typeof time === 'object'
      && Number.isInteger(time.year)
      && Number.isInteger(time.month)
      && Number.isInteger(time.day)
    )
}

function isValidPoint(point) {
  return point !== null
    && typeof point === 'object'
    && isValidTime(point.time)
    && Number.isFinite(point.price)
}

function isValidLine(line) {
  return line !== null
    && typeof line === 'object'
    && isValidPoint(line.start)
    && isValidPoint(line.end)
}

export function loadTrendLines(symbol) {
  if (!symbol) return []

  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(symbol)))
    return Array.isArray(parsed) ? parsed.filter(isValidLine) : []
  } catch {
    return []
  }
}

export function saveTrendLines(symbol, lines) {
  if (!symbol) return
  localStorage.setItem(storageKey(symbol), JSON.stringify(lines))
}

export function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / lengthSquared))
  const nearestX = x1 + t * dx
  const nearestY = y1 + t * dy

  return Math.hypot(px - nearestX, py - nearestY)
}
