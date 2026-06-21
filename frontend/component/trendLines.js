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

export function createTrendLinesPrimitive() {
  let lines = []
  let selectedIndex = -1
  let preview = null
  let chart = null
  let series = null
  let requestUpdate = null

  const coordinates = line => {
    if (!chart || !series) return null

    const timeScale = chart.timeScale()
    const x1 = timeScale.timeToCoordinate(line.start.time)
    const y1 = series.priceToCoordinate(line.start.price)
    const x2 = timeScale.timeToCoordinate(line.end.time)
    const y2 = series.priceToCoordinate(line.end.price)

    return x1 === null || y1 === null || x2 === null || y2 === null
      ? null
      : { x1, y1, x2, y2 }
  }

  return {
    setLines(nextLines, nextSelectedIndex = -1) {
      lines = nextLines
      selectedIndex = nextSelectedIndex
      requestUpdate?.()
    },

    setPreview(nextPreview) {
      preview = nextPreview
      requestUpdate?.()
    },

    lineIndexAt(x, y) {
      for (let index = lines.length - 1; index >= 0; index--) {
        const points = coordinates(lines[index])
        if (points && distanceToSegment(x, y, points.x1, points.y1, points.x2, points.y2) <= 6) {
          return index
        }
      }
      return -1
    },

    attached(params) {
      chart = params.chart
      series = params.series
      requestUpdate = params.requestUpdate
    },

    detached() {
      chart = null
      series = null
      requestUpdate = null
    },

    paneViews() {
      return [{
        zOrder: () => 'top',
        renderer: () => ({
          draw(target) {
            target.useBitmapCoordinateSpace(scope => {
              const { context, horizontalPixelRatio, verticalPixelRatio } = scope

              for (let index = 0; index < lines.length; index++) {
                const points = coordinates(lines[index])
                if (!points) continue

                context.beginPath()
                context.strokeStyle = index === selectedIndex ? '#ffffff' : '#f0b429'
                context.lineWidth = (index === selectedIndex ? 3 : 2) * horizontalPixelRatio
                context.moveTo(points.x1 * horizontalPixelRatio, points.y1 * verticalPixelRatio)
                context.lineTo(points.x2 * horizontalPixelRatio, points.y2 * verticalPixelRatio)
                context.stroke()
              }

              if (preview) {
                const pts = coordinates(preview)
                if (pts) {
                  context.beginPath()
                  context.strokeStyle = '#f0b429'
                  context.lineWidth = 2 * horizontalPixelRatio
                  context.setLineDash([6, 4])
                  context.moveTo(pts.x1 * horizontalPixelRatio, pts.y1 * verticalPixelRatio)
                  context.lineTo(pts.x2 * horizontalPixelRatio, pts.y2 * verticalPixelRatio)
                  context.stroke()
                  context.setLineDash([])
                }
              }
            })
          },
        }),
      }]
    },
  }
}
