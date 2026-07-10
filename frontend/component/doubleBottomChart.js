/**
 * lightweight-charts v5 primitive for double-top and double-bottom overlays.
 */

/**
 * @param {import('./doubleBottom.js').DoubleBottomPattern[]} patterns
 */
export function createPricePatternPrimitive() {
  let patterns = []
  let labels = {
    top1: 'Top 1',
    top2: 'Top 2',
    bottom1: 'Bottom 1',
    bottom2: 'Bottom 2',
    neckline: 'Neckline',
  }
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

    setLabels(nextLabels) {
      labels = nextLabels
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
                const isTop = pattern.type === 'double-top'
                const confirmed = pattern.status === 'confirmed'
                const failed = pattern.status === 'failed'
                const lineColor = failed
                  ? '#8892a4'
                  : isTop
                    ? (confirmed ? '#ef5350' : 'rgba(239, 83, 80, 0.55)')
                    : (confirmed ? '#26a69a' : 'rgba(38, 166, 154, 0.55)')
                const path = isTop
                  ? [pattern.l0, pattern.t1, pattern.l1, pattern.t2]
                  : [pattern.h0, pattern.l1, pattern.h1, pattern.l2]
                const points = path.map(point => coordinates(point.time, point.price))

                if (points.every(Boolean)) {
                  ctx.beginPath()
                  ctx.strokeStyle = lineColor
                  ctx.lineWidth = 2 * hr
                  ctx.setLineDash(confirmed ? [] : failed ? [2 * hr, 4 * hr] : [6 * hr, 4 * hr])
                  ctx.moveTo(points[0].x * hr, points[0].y * vr)
                  for (let i = 1; i < points.length; i++) {
                    ctx.lineTo(points[i].x * hr, points[i].y * vr)
                  }
                  ctx.stroke()
                  ctx.setLineDash([])
                }

                const first = points[1]
                const neckline = points[2]
                const second = points[3]
                if (first) drawLabel(ctx, first.x, first.y, isTop ? labels.top1 : labels.bottom1, lineColor, hr, vr, isTop)
                if (second) drawLabel(ctx, second.x, second.y, isTop ? labels.top2 : labels.bottom2, lineColor, hr, vr, isTop)

                if (first && second && neckline) {
                  ctx.beginPath()
                  ctx.strokeStyle = lineColor
                  ctx.lineWidth = (confirmed ? 2 : 1.5) * hr
                  ctx.setLineDash([6 * hr, 4 * hr])
                  ctx.moveTo(first.x * hr, neckline.y * vr)
                  ctx.lineTo(second.x * hr, neckline.y * vr)
                  ctx.stroke()
                  ctx.setLineDash([])

                  const midX = (first.x + second.x) / 2
                  drawLabel(ctx, midX, neckline.y, labels.neckline, lineColor, hr, vr, !isTop)
                }
              }
            })
          },
        }),
      }]
    },
  }
}
