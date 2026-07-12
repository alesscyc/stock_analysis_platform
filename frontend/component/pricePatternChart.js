/**
 * lightweight-charts v5 primitive for normalized price-pattern overlays.
 */

export function createPricePatternPrimitive() {
  let patterns = []
  let resolveLabel = key => key
  let chart = null
  let series = null
  let requestUpdate = null

  const coordinates = (time, price) => {
    if (!chart || !series) return null
    const x = chart.timeScale().timeToCoordinate(time)
    const y = series.priceToCoordinate(price)
    if (x === null || y === null) return null
    return { x, y }
  }

  const drawLabel = (ctx, x, y, text, color, hr, vr, above = true) => {
    const fontSize = Math.round(10 * hr)
    ctx.font = `600 ${fontSize}px 'Inter', 'Helvetica Neue', Arial, sans-serif`
    const metrics = ctx.measureText(text)
    const padX = 5 * hr
    const padY = 3 * vr
    const boxW = metrics.width + padX * 2
    const boxH = fontSize + padY * 2
    const boxX = x * hr - boxW / 2
    const boxY = above ? (y * vr - boxH - 6 * vr) : (y * vr + 6 * vr)

    ctx.fillStyle = '#1c2030'
    ctx.strokeStyle = color
    ctx.lineWidth = 1
    ctx.beginPath()
    const r = 3 * hr
    ctx.moveTo(boxX + r, boxY)
    ctx.arcTo(boxX + boxW, boxY, boxX + boxW, boxY + boxH, r)
    ctx.arcTo(boxX + boxW, boxY + boxH, boxX, boxY + boxH, r)
    ctx.arcTo(boxX, boxY + boxH, boxX, boxY, r)
    ctx.arcTo(boxX, boxY, boxX + boxW, boxY, r)
    ctx.closePath()
    ctx.fill()
    ctx.stroke()

    ctx.fillStyle = color
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(text, x * hr, boxY + boxH / 2)
  }

  return {
    setPatterns(nextPatterns) {
      patterns = nextPatterns
      requestUpdate?.()
    },

    setLabelResolver(nextResolver) {
      resolveLabel = nextResolver
      requestUpdate?.()
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
            if (!chart || !series || !patterns.length) return

            target.useBitmapCoordinateSpace(scope => {
              const ctx = scope.context
              const hr = scope.horizontalPixelRatio
              const vr = scope.verticalPixelRatio

              for (const pattern of patterns) {
                const confirmed = pattern.status === 'confirmed'
                const failed = pattern.status === 'failed'
                const lineColor = pattern.color

                const area = pattern.lines.find(line => line.style === 'status')
                  ?.points.map(point => coordinates(point.time, point.price))
                let areaBounds = null
                if (area?.every(Boolean)) {
                  const xs = area.map(point => point.x)
                  const ys = area.map(point => point.y)
                  const left = Math.min(...xs)
                  const top = Math.min(...ys)
                  const right = Math.max(...xs)
                  const bottom = Math.max(...ys)
                  areaBounds = { left, top, right, bottom }

                  ctx.save()
                  ctx.fillStyle = lineColor
                  ctx.globalAlpha = 0.08
                  ctx.fillRect(left * hr, top * vr, (right - left) * hr, (bottom - top) * vr)
                  ctx.restore()
                }

                for (const line of pattern.lines) {
                  const points = line.points.map(point => coordinates(point.time, point.price))
                  if (!points.every(Boolean)) continue

                  const style = line.style === 'status'
                    ? confirmed ? 'solid' : failed ? 'dotted' : 'dashed'
                    : line.style
                  ctx.beginPath()
                  ctx.strokeStyle = lineColor
                  ctx.lineWidth = (line.width ?? 2) * hr
                  ctx.setLineDash(style === 'dotted'
                    ? [2 * hr, 4 * hr]
                    : style === 'dashed' ? [6 * hr, 4 * hr] : [])
                  ctx.moveTo(points[0].x * hr, points[0].y * vr)
                  for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i].x * hr, points[i].y * vr)
                  }
                  ctx.stroke()
                  ctx.setLineDash([])
                }

                if (areaBounds) {
                  const labelAtBottom = pattern.type.includes('bottom')
                  drawLabel(
                    ctx,
                    (areaBounds.left + areaBounds.right) / 2,
                    labelAtBottom ? areaBounds.bottom : areaBounds.top,
                    resolveLabel(pattern.nameKey),
                    lineColor,
                    hr,
                    vr,
                    !labelAtBottom,
                  )
                }
              }
            })
          },
        }),
      }]
    },
  }
}
