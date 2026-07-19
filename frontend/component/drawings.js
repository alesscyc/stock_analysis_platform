const DRAWINGS_KEY = symbol => `stockai-drawings:${symbol.toUpperCase()}`
const LEGACY_KEY = symbol => `stockai-trend-lines:${symbol.toUpperCase()}`

const TWO_POINT_TYPES = new Set(['trendline', 'ray', 'rect', 'pricerange'])

// Label: "9.75 (14.57%)" — abs delta + percent only
export function priceRangeStats(startPrice, endPrice) {
  const delta = endPrice - startPrice
  const pct = startPrice !== 0 ? (delta / Math.abs(startPrice)) * 100 : 0
  const absDelta = Math.abs(delta)
  return {
    deltaText: absDelta.toFixed(2),
    pctText: `(${Math.abs(pct).toFixed(2)}%)`,
    label: `${absDelta.toFixed(2)} (${Math.abs(pct).toFixed(2)}%)`,
    up: delta >= 0,
  }
}

export function priceRangeLabel(startPrice, endPrice) {
  return priceRangeStats(startPrice, endPrice).label
}

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

function normalizeDrawing(raw) {
  if (raw === null || typeof raw !== 'object') return null

  // Legacy untyped segment → trendline
  if (!raw.type && isValidPoint(raw.start) && isValidPoint(raw.end)) {
    return { type: 'trendline', start: raw.start, end: raw.end }
  }

  if (raw.type === 'hline' && Number.isFinite(raw.price)) {
    return { type: 'hline', price: raw.price }
  }

  if (TWO_POINT_TYPES.has(raw.type) && isValidPoint(raw.start) && isValidPoint(raw.end)) {
    return { type: raw.type, start: raw.start, end: raw.end }
  }

  return null
}

function parseDrawings(raw) {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.map(normalizeDrawing).filter(Boolean) : []
  } catch {
    return []
  }
}

export function loadDrawings(symbol) {
  if (!symbol) return []

  const modern = localStorage.getItem(DRAWINGS_KEY(symbol))
  if (modern != null) return parseDrawings(modern)

  const legacy = localStorage.getItem(LEGACY_KEY(symbol))
  if (legacy == null) return []

  const migrated = parseDrawings(legacy)
  if (migrated.length > 0) {
    localStorage.setItem(DRAWINGS_KEY(symbol), JSON.stringify(migrated))
  }
  return migrated
}

export function saveDrawings(symbol, drawings) {
  if (!symbol) return
  localStorage.setItem(DRAWINGS_KEY(symbol), JSON.stringify(drawings))
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

export function distanceToRay(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  const lengthSquared = dx * dx + dy * dy
  const t = lengthSquared === 0
    ? 0
    : Math.max(0, ((px - x1) * dx + (py - y1) * dy) / lengthSquared)
  const nearestX = x1 + t * dx
  const nearestY = y1 + t * dy

  return Math.hypot(px - nearestX, py - nearestY)
}

function extendRayToEdge(x1, y1, x2, y2, width, height) {
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return { x1, y1, x2, y2 }

  let tMax = Infinity
  if (dx > 0) tMax = Math.min(tMax, (width - x1) / dx)
  else if (dx < 0) tMax = Math.min(tMax, (0 - x1) / dx)
  if (dy > 0) tMax = Math.min(tMax, (height - y1) / dy)
  else if (dy < 0) tMax = Math.min(tMax, (0 - y1) / dy)

  if (!Number.isFinite(tMax) || tMax < 1) tMax = Math.max(tMax, 1)
  return { x1, y1, x2: x1 + dx * tMax, y2: y1 + dy * tMax }
}

function twoPointCoords(chart, series, drawing) {
  if (!chart || !series) return null
  const timeScale = chart.timeScale()
  const x1 = timeScale.timeToCoordinate(drawing.start.time)
  const y1 = series.priceToCoordinate(drawing.start.price)
  const x2 = timeScale.timeToCoordinate(drawing.end.time)
  const y2 = series.priceToCoordinate(drawing.end.price)
  return x1 === null || y1 === null || x2 === null || y2 === null
    ? null
    : { x1, y1, x2, y2 }
}

function hitTestDrawing(drawing, x, y, chart, series) {
  if (!chart || !series) return false

  if (drawing.type === 'hline') {
    const py = series.priceToCoordinate(drawing.price)
    return py !== null && Math.abs(y - py) <= 6
  }

  const pts = twoPointCoords(chart, series, drawing)
  if (!pts) return false

  if (drawing.type === 'ray') {
    return distanceToRay(x, y, pts.x1, pts.y1, pts.x2, pts.y2) <= 6
  }

  if (drawing.type === 'rect' || drawing.type === 'pricerange') {
    const left = Math.min(pts.x1, pts.x2)
    const right = Math.max(pts.x1, pts.x2)
    const top = Math.min(pts.y1, pts.y2)
    const bottom = Math.max(pts.y1, pts.y2)
    // Price range: whole band is selectable (TradingView-like)
    if (
      drawing.type === 'pricerange'
      && x >= left - 6 && x <= right + 6
      && y >= top - 6 && y <= bottom + 6
    ) {
      return true
    }
    return distanceToSegment(x, y, left, top, right, top) <= 6
      || distanceToSegment(x, y, right, top, right, bottom) <= 6
      || distanceToSegment(x, y, right, bottom, left, bottom) <= 6
      || distanceToSegment(x, y, left, bottom, left, top) <= 6
  }

  // trendline
  return distanceToSegment(x, y, pts.x1, pts.y1, pts.x2, pts.y2) <= 6
}

const DRAW_COLOR = '#2962ff'
const DRAW_FILL = 'rgba(41, 98, 255, 0.18)'
const DRAW_FILL_SELECTED = 'rgba(255, 255, 255, 0.12)'

function strokeStyle(context, selected, hr) {
  context.strokeStyle = selected ? '#ffffff' : DRAW_COLOR
  context.lineWidth = (selected ? 3 : 2) * hr
}

// Match TradingView screenshot: blue band, top/bottom lines, center arrow, label above

function drawPriceRangeArrow(context, cx, yTip, pointingUp, hr, vr, color) {
  const w = 5 * hr
  const h = 7 * vr
  context.fillStyle = color
  context.beginPath()
  if (pointingUp) {
    context.moveTo(cx, yTip)
    context.lineTo(cx - w, yTip + h)
    context.lineTo(cx + w, yTip + h)
  } else {
    context.moveTo(cx, yTip)
    context.lineTo(cx - w, yTip - h)
    context.lineTo(cx + w, yTip - h)
  }
  context.closePath()
  context.fill()
}

function drawPriceRange(context, drawing, pts, selected, hr, vr, dashed) {
  const left = Math.min(pts.x1, pts.x2) * hr
  const right = Math.max(pts.x1, pts.x2) * hr
  const yTop = Math.min(pts.y1, pts.y2) * vr
  const yBot = Math.max(pts.y1, pts.y2) * vr
  const width = Math.max(right - left, 1)
  const color = selected ? '#ffffff' : DRAW_COLOR
  const cx = left + width / 2
  const stats = priceRangeStats(drawing.start.price, drawing.end.price)
  // Arrow at end point (second click): smaller canvas y = higher price = point up
  const pointingUp = pts.y2 <= pts.y1

  context.fillStyle = selected ? DRAW_FILL_SELECTED : DRAW_FILL
  context.fillRect(left, yTop, width, yBot - yTop)

  context.beginPath()
  context.strokeStyle = color
  context.lineWidth = 2 * hr
  if (dashed) context.setLineDash([6, 4])
  context.moveTo(left, yTop)
  context.lineTo(right, yTop)
  context.moveTo(left, yBot)
  context.lineTo(right, yBot)
  context.stroke()

  // Center vertical measure + arrowhead at end
  const arrowH = 7 * vr
  const lineTop = pointingUp ? yTop + arrowH : yTop
  const lineBot = pointingUp ? yBot : yBot - arrowH
  context.beginPath()
  context.moveTo(cx, lineTop)
  context.lineTo(cx, lineBot)
  context.stroke()
  if (!dashed) {
    drawPriceRangeArrow(context, cx, pointingUp ? yTop : yBot, pointingUp, hr, vr, color)
  }

  if (dashed) {
    context.setLineDash([])
    return
  }

  // Label pill above top line — "9.75 (14.57%)"
  const label = stats.label
  const fontSize = Math.round(11 * hr)
  context.font = `600 ${fontSize}px 'Inter', 'Helvetica Neue', Arial, sans-serif`
  const textW = context.measureText(label).width
  const padX = 8 * hr
  const padY = 4 * vr
  const boxW = textW + padX * 2
  const boxH = fontSize + padY * 2
  const boxX = cx - boxW / 2
  const boxY = yTop - boxH - 6 * vr
  const r = 4 * hr

  context.fillStyle = '#1c2030'
  context.beginPath()
  context.moveTo(boxX + r, boxY)
  context.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, r)
  context.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, r)
  context.arcTo(boxX, boxY + boxH, boxX, boxY, r)
  context.arcTo(boxX, boxY, boxX + boxW, boxY, r)
  context.closePath()
  context.fill()

  context.fillStyle = '#e8ecf0'
  context.textAlign = 'center'
  context.textBaseline = 'middle'
  context.fillText(label, cx, boxY + boxH / 2 + 0.5 * vr)
}

function drawShape(context, drawing, chart, series, selected, hr, vr, mediaWidth, mediaHeight, dashed = false) {
  if (drawing.type === 'hline') {
    const y = series.priceToCoordinate(drawing.price)
    if (y === null) return
    context.beginPath()
    strokeStyle(context, selected, hr)
    if (dashed) context.setLineDash([6, 4])
    context.moveTo(0, y * vr)
    context.lineTo(mediaWidth * hr, y * vr)
    context.stroke()
    if (dashed) context.setLineDash([])
    return
  }

  const pts = twoPointCoords(chart, series, drawing)
  if (!pts) return

  if (drawing.type === 'pricerange') {
    drawPriceRange(context, drawing, pts, selected, hr, vr, dashed)
    return
  }

  if (drawing.type === 'rect') {
    const left = Math.min(pts.x1, pts.x2) * hr
    const top = Math.min(pts.y1, pts.y2) * vr
    const width = Math.abs(pts.x2 - pts.x1) * hr
    const height = Math.abs(pts.y2 - pts.y1) * vr
    context.fillStyle = selected ? DRAW_FILL_SELECTED : DRAW_FILL
    context.fillRect(left, top, width, height)
    context.beginPath()
    strokeStyle(context, selected, hr)
    if (dashed) context.setLineDash([6, 4])
    context.strokeRect(left, top, width, height)
    if (dashed) context.setLineDash([])
    return
  }

  let x1 = pts.x1
  let y1 = pts.y1
  let x2 = pts.x2
  let y2 = pts.y2
  if (drawing.type === 'ray') {
    ;({ x1, y1, x2, y2 } = extendRayToEdge(x1, y1, x2, y2, mediaWidth, mediaHeight))
  }

  context.beginPath()
  strokeStyle(context, selected, hr)
  if (dashed) context.setLineDash([6, 4])
  context.moveTo(x1 * hr, y1 * vr)
  context.lineTo(x2 * hr, y2 * vr)
  context.stroke()
  if (dashed) context.setLineDash([])
}

export function createDrawingsPrimitive() {
  let drawings = []
  let selectedIndex = -1
  let preview = null
  let chart = null
  let series = null
  let requestUpdate = null

  return {
    setDrawings(nextDrawings, nextSelectedIndex = -1) {
      drawings = nextDrawings
      selectedIndex = nextSelectedIndex
      requestUpdate?.()
    },

    setPreview(nextPreview) {
      preview = nextPreview
      requestUpdate?.()
    },

    drawingIndexAt(x, y) {
      for (let index = drawings.length - 1; index >= 0; index--) {
        if (hitTestDrawing(drawings[index], x, y, chart, series)) return index
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
              const { context, horizontalPixelRatio, verticalPixelRatio, mediaSize, bitmapSize } = scope
              const mediaWidth = mediaSize?.width ?? bitmapSize.width / horizontalPixelRatio
              const mediaHeight = mediaSize?.height ?? bitmapSize.height / verticalPixelRatio

              for (let index = 0; index < drawings.length; index++) {
                drawShape(
                  context,
                  drawings[index],
                  chart,
                  series,
                  index === selectedIndex,
                  horizontalPixelRatio,
                  verticalPixelRatio,
                  mediaWidth,
                  mediaHeight,
                )
              }

              if (preview) {
                drawShape(
                  context,
                  preview,
                  chart,
                  series,
                  false,
                  horizontalPixelRatio,
                  verticalPixelRatio,
                  mediaWidth,
                  mediaHeight,
                  true,
                )
              }
            })
          },
        }),
      }]
    },
  }
}
