/**
 * lightweight-charts v5 primitive for double-bottom pattern overlays.
 */

/**
 * @param {import('./doubleBottom.js').DoubleBottomPattern[]} patterns
 */
export function createDoubleBottomPrimitive() {
  let patterns = []
  let labels = { bottom1: 'Bottom 1', bottom2: 'Bottom 2', neckline: 'Neckline' }
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
                const confirmed = pattern.status === 'confirmed'
                const lineColor = confirmed ? '#26a69a' : '#8892a4'
                const h0 = coordinates(pattern.h0.time, pattern.h0.price)
                const l1 = coordinates(pattern.l1.time, pattern.l1.price)
                const h1 = coordinates(pattern.h1.time, pattern.h1.price)
                const l2 = coordinates(pattern.l2.time, pattern.l2.price)

                const wPath = [h0, l1, h1, l2].filter(Boolean)
                if (wPath.length >= 2) {
                  ctx.beginPath()
                  ctx.strokeStyle = lineColor
                  ctx.lineWidth = 2 * hr
                  ctx.setLineDash([])
                  ctx.moveTo(wPath[0].x * hr, wPath[0].y * vr)
                  for (let i = 1; i < wPath.length; i++) {
                    ctx.lineTo(wPath[i].x * hr, wPath[i].y * vr)
                  }
                  ctx.stroke()
                }

                if (l1) drawLabel(ctx, l1.x, l1.y, labels.bottom1, lineColor, hr, vr, false)
                if (l2) drawLabel(ctx, l2.x, l2.y, labels.bottom2, lineColor, hr, vr, false)

                if (l1 && l2 && h1) {
                  ctx.beginPath()
                  ctx.strokeStyle = lineColor
                  ctx.lineWidth = (confirmed ? 2 : 1.5) * hr
                  ctx.setLineDash([6 * hr, 4 * hr])
                  ctx.moveTo(l1.x * hr, h1.y * vr)
                  ctx.lineTo(l2.x * hr, h1.y * vr)
                  ctx.stroke()
                  ctx.setLineDash([])

                  const midX = (l1.x + l2.x) / 2
                  drawLabel(ctx, midX, h1.y, labels.neckline, lineColor, hr, vr, true)
                }
              }
            })
          },
        }),
      }]
    },
  }
}
