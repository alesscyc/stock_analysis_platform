# Chart Trend Line Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a two-click trend-line tool that persists per symbol and supports click selection plus Delete/Backspace removal.

**Architecture:** Keep chart interaction state in `StockChart.jsx`, but put storage, geometry, and the lightweight-charts primitive in one focused `trendLines.js` module. Attach one primitive to the existing candlestick series and update it from React state; no new dependency or chart series per line.

**Tech Stack:** React 19, lightweight-charts 5.1, browser `localStorage`, Vitest, Testing Library.

---

## File Map

- Create `frontend/component/trendLines.js`: storage validation, point-to-segment hit testing, and the custom canvas primitive.
- Create `frontend/component/trendLines.test.js`: focused unit tests for persistence and geometry.
- Create `frontend/component/StockChart.test.jsx`: interaction test with lightweight-charts mocked at its boundary.
- Modify `frontend/component/StockChart.jsx`: toolbar state, two-click creation, selection, deletion, persistence, and primitive lifecycle.
- Modify `frontend/component/StockChart.css`: active tool and chart cursor styles.
- Modify `frontend/src/i18n/translations.js`: English and Traditional Chinese button labels.

### Task 1: Trend-line storage and geometry

**Files:**

- Create: `frontend/component/trendLines.js`
- Test: `frontend/component/trendLines.test.js`

- [ ] **Step 1: Write failing storage and hit-test tests**

```js
import { beforeEach, describe, expect, it } from 'vitest'
import {
  distanceToSegment,
  loadTrendLines,
  saveTrendLines,
} from './trendLines'

const line = {
  start: { time: '2026-01-02', price: 100 },
  end: { time: '2026-01-03', price: 110 },
}

describe('trend lines', () => {
  beforeEach(() => localStorage.clear())

  it('persists valid lines per uppercase symbol', () => {
    saveTrendLines('aapl', [line])

    expect(loadTrendLines('AAPL')).toEqual([line])
    expect(loadTrendLines('MSFT')).toEqual([])
  })

  it('ignores malformed stored data', () => {
    localStorage.setItem('stockai-trend-lines:AAPL', '{"bad":true}')
    expect(loadTrendLines('AAPL')).toEqual([])
  })

  it('measures distance to a line segment', () => {
    expect(distanceToSegment(5, 2, 0, 0, 10, 0)).toBe(2)
    expect(distanceToSegment(15, 0, 0, 0, 10, 0)).toBe(5)
  })
})
```

- [ ] **Step 2: Run the unit test and verify RED**

Run:

```bash
cd frontend
npm test -- component/trendLines.test.js
```

Expected: FAIL because `./trendLines` does not exist.

- [ ] **Step 3: Implement the minimal helpers**

Create `frontend/component/trendLines.js` with:

```js
const keyFor = symbol => `stockai-trend-lines:${String(symbol || '').toUpperCase()}`

const isTime = time =>
  typeof time === 'string' ||
  typeof time === 'number' ||
  (
    time &&
    Number.isInteger(time.year) &&
    Number.isInteger(time.month) &&
    Number.isInteger(time.day)
  )

const isPoint = point => point && isTime(point.time) && Number.isFinite(point.price)

const isLine = line => line && isPoint(line.start) && isPoint(line.end)

export function loadTrendLines(symbol) {
  if (!symbol) return []
  try {
    const parsed = JSON.parse(localStorage.getItem(keyFor(symbol)) || '[]')
    return Array.isArray(parsed) ? parsed.filter(isLine) : []
  } catch {
    return []
  }
}

export function saveTrendLines(symbol, lines) {
  if (symbol) localStorage.setItem(keyFor(symbol), JSON.stringify(lines))
}

export function distanceToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1
  const dy = y2 - y1
  if (dx === 0 && dy === 0) return Math.hypot(px - x1, py - y1)
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)))
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy))
}
```

- [ ] **Step 4: Run the unit test and verify GREEN**

Run:

```bash
cd frontend
npm test -- component/trendLines.test.js
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/component/trendLines.js frontend/component/trendLines.test.js
git commit -m "Add trend line storage and geometry"
```

### Task 2: Canvas primitive

**Files:**

- Modify: `frontend/component/trendLines.js`
- Modify: `frontend/component/trendLines.test.js`

- [ ] **Step 1: Write a failing primitive hit-test test**

Append:

```js
import { createTrendLinesPrimitive } from './trendLines'

it('selects the nearest rendered line within six pixels', () => {
  const primitive = createTrendLinesPrimitive()
  primitive.attached({
    chart: { timeScale: () => ({ timeToCoordinate: time => time === 'a' ? 10 : 90 }) },
    series: { priceToCoordinate: price => price },
    requestUpdate: () => {},
  })
  primitive.setLines([
    { start: { time: 'a', price: 20 }, end: { time: 'b', price: 20 } },
  ])

  expect(primitive.hitTest(50, 24)).toBe(0)
  expect(primitive.hitTest(50, 30)).toBe(-1)
})
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
cd frontend
npm test -- component/trendLines.test.js
```

Expected: FAIL because `createTrendLinesPrimitive` is not exported.

- [ ] **Step 3: Add the primitive**

Append this export to `trendLines.js`:

```js
export function createTrendLinesPrimitive() {
  let lines = []
  let selectedIndex = -1
  let chart = null
  let series = null
  let requestUpdate = null

  const coordinates = line => {
    const scale = chart?.timeScale()
    const x1 = scale?.timeToCoordinate(line.start.time)
    const x2 = scale?.timeToCoordinate(line.end.time)
    const y1 = series?.priceToCoordinate(line.start.price)
    const y2 = series?.priceToCoordinate(line.end.price)
    return [x1, y1, x2, y2].some(value => value == null) ? null : { x1, y1, x2, y2 }
  }

  return {
    setLines(nextLines, nextSelectedIndex = -1) {
      lines = nextLines
      selectedIndex = nextSelectedIndex
      requestUpdate?.()
    },
    hitTest(x, y) {
      for (let index = lines.length - 1; index >= 0; index--) {
        const point = coordinates(lines[index])
        if (point && distanceToSegment(x, y, point.x1, point.y1, point.x2, point.y2) <= 6) return index
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
          draw: target => target.useBitmapCoordinateSpace(scope => {
            const ctx = scope.context
            const hr = scope.horizontalPixelRatio
            const vr = scope.verticalPixelRatio
            lines.forEach((line, index) => {
              const point = coordinates(line)
              if (!point) return
              ctx.beginPath()
              ctx.strokeStyle = index === selectedIndex ? '#ffffff' : '#f0b429'
              ctx.lineWidth = (index === selectedIndex ? 3 : 2) * hr
              ctx.moveTo(point.x1 * hr, point.y1 * vr)
              ctx.lineTo(point.x2 * hr, point.y2 * vr)
              ctx.stroke()
            })
          }),
        }),
      }]
    },
  }
}
```

- [ ] **Step 4: Run the unit test and verify GREEN**

Run:

```bash
cd frontend
npm test -- component/trendLines.test.js
```

Expected: 4 tests pass.

- [ ] **Step 5: Commit**

```bash
git add frontend/component/trendLines.js frontend/component/trendLines.test.js
git commit -m "Add trend line chart primitive"
```

### Task 3: Chart interaction and persistence

**Files:**

- Create: `frontend/component/StockChart.test.jsx`
- Modify: `frontend/component/StockChart.jsx`
- Modify: `frontend/src/i18n/translations.js`

- [ ] **Step 1: Write the failing two-click and deletion test**

Create `frontend/component/StockChart.test.jsx`:

```jsx
import { act, fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { I18nProvider } from '../src/i18n/I18nContext.jsx'
import StockChart from './StockChart'

const chartMock = vi.hoisted(() => ({ click: null }))

vi.mock('lightweight-charts', () => {
  const timeToCoordinate = time => time === '2026-01-02' ? 10 : 90
  const series = {
    setData: vi.fn(),
    applyOptions: vi.fn(),
    createPriceLine: vi.fn(() => ({})),
    removePriceLine: vi.fn(),
    priceToCoordinate: price => price,
    coordinateToPrice: y => y,
    attachPrimitive(primitive) {
      primitive.attached?.({
        chart,
        series,
        requestUpdate: vi.fn(),
      })
    },
  }
  const timeScale = {
    width: () => 100,
    timeToCoordinate,
    setVisibleRange: vi.fn(),
  }
  const chart = {
    addSeries: vi.fn(() => series),
    applyOptions: vi.fn(),
    priceScale: vi.fn(() => ({ applyOptions: vi.fn() })),
    resize: vi.fn(),
    remove: vi.fn(),
    timeScale: () => timeScale,
    subscribeClick: callback => { chartMock.click = callback },
    unsubscribeClick: vi.fn(),
  }
  return {
    createChart: () => chart,
    CandlestickSeries: {},
    HistogramSeries: {},
    LineSeries: {},
    CrosshairMode: { Normal: 0 },
    LineStyle: { Dotted: 1, Solid: 0 },
  }
})

class ResizeObserver {
  observe() {}
  disconnect() {}
}
global.ResizeObserver = ResizeObserver

const stockData = [
  { Date: '2026-01-02', Open: 100, High: 110, Low: 95, Close: 105, Volume: 1000 },
  { Date: '2026-01-03', Open: 105, High: 115, Low: 100, Close: 112, Volume: 1200 },
]

describe('StockChart trend line tool', () => {
  beforeEach(() => {
    localStorage.clear()
    chartMock.click = null
  })

  it('creates, persists, selects, and deletes a trend line', () => {
    render(
      <I18nProvider>
        <StockChart
          stockData={stockData}
          stockSymbol="AAPL"
          currentInterval="1d"
          onIntervalChange={() => {}}
        />
      </I18nProvider>
    )

    fireEvent.click(screen.getByRole('button', { name: /trend line/i }))
    act(() => chartMock.click({ point: { x: 10, y: 100 }, time: '2026-01-02' }))
    act(() => chartMock.click({ point: { x: 90, y: 120 }, time: '2026-01-03' }))

    expect(JSON.parse(localStorage.getItem('stockai-trend-lines:AAPL'))).toHaveLength(1)

    fireEvent.mouseDown(document.querySelector('#lw-chart-container'), {
      clientX: 50,
      clientY: 110,
    })
    fireEvent.keyDown(window, { key: 'Delete' })

    expect(JSON.parse(localStorage.getItem('stockai-trend-lines:AAPL'))).toEqual([])
  })
})
```

- [ ] **Step 2: Run the component test and verify RED**

Run:

```bash
cd frontend
npm test -- component/StockChart.test.jsx
```

Expected: FAIL because the Trend Line button is absent.

- [ ] **Step 3: Add chart state and primitive wiring**

In `StockChart.jsx`:

```js
import {
  createTrendLinesPrimitive,
  loadTrendLines,
  saveTrendLines,
} from './trendLines'
```

Add refs/state beside the existing chart refs:

```js
const trendLinesPrimitiveRef = useRef(null)
const drawingStartRef = useRef(null)
const drawingModeRef = useRef(false)
const skipTrendLineSaveRef = useRef(true)
const [drawingMode, setDrawingMode] = useState(false)
const [trendLines, setTrendLines] = useState(() => loadTrendLines(stockSymbol))
const [selectedTrendLine, setSelectedTrendLine] = useState(-1)
```

Keep the event callback current:

```js
useEffect(() => {
  drawingModeRef.current = drawingMode
}, [drawingMode])
```

Attach one primitive after the swing primitive:

```js
const trendLinesPrimitive = createTrendLinesPrimitive()
candleSeries.attachPrimitive(trendLinesPrimitive)
trendLinesPrimitiveRef.current = trendLinesPrimitive
```

Subscribe inside the chart mount effect:

```js
const handleChartClick = param => {
  if (!drawingModeRef.current || !param.point || param.time == null) return
  const price = candleSeries.coordinateToPrice(param.point.y)
  if (!Number.isFinite(price)) return
  const point = { time: param.time, price: Math.round(price * 100) / 100 }

  if (!drawingStartRef.current) {
    drawingStartRef.current = point
    return
  }

  const start = drawingStartRef.current
  drawingStartRef.current = null
  drawingModeRef.current = false
  setDrawingMode(false)
  setTrendLines(lines => [...lines, { start, end: point }])
}

chart.subscribeClick(handleChartClick)
```

Unsubscribe and clear the primitive ref during cleanup:

```js
chart.unsubscribeClick(handleChartClick)
trendLinesPrimitiveRef.current = null
```

- [ ] **Step 4: Add symbol loading, persistence, primitive sync, selection, and deletion**

Add effects:

```js
useEffect(() => {
  skipTrendLineSaveRef.current = true
  setTrendLines(loadTrendLines(stockSymbol))
  setSelectedTrendLine(-1)
  setDrawingMode(false)
  drawingStartRef.current = null
}, [stockSymbol])

useEffect(() => {
  if (skipTrendLineSaveRef.current) {
    skipTrendLineSaveRef.current = false
    trendLinesPrimitiveRef.current?.setLines(trendLines, selectedTrendLine)
    return
  }
  saveTrendLines(stockSymbol, trendLines)
  trendLinesPrimitiveRef.current?.setLines(trendLines, selectedTrendLine)
}, [stockSymbol, trendLines, selectedTrendLine])

useEffect(() => {
  const handleKeyDown = event => {
    if (!['Delete', 'Backspace'].includes(event.key) || selectedTrendLine < 0) return
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target?.isContentEditable) return
    event.preventDefault()
    setTrendLines(lines => lines.filter((_, index) => index !== selectedTrendLine))
    setSelectedTrendLine(-1)
  }
  window.addEventListener('keydown', handleKeyDown)
  return () => window.removeEventListener('keydown', handleKeyDown)
}, [selectedTrendLine])
```

At the start of the existing chart `mousedown` handler, before IB-order handling:

```js
if (drawingModeRef.current) return
const point = getMousePoint(e)
const trendHit = trendLinesPrimitiveRef.current?.hitTest(point.x, point.y) ?? -1
if (trendHit >= 0) {
  e.preventDefault()
  setSelectedTrendLine(trendHit)
  return
}
setSelectedTrendLine(-1)
```

Reuse that `point` variable in the remaining IB-order code.

- [ ] **Step 5: Add the accessible toolbar button and translations**

Place the button after the interval selector:

```jsx
<button
  id="trend-line-btn"
  className={drawingMode ? 'active' : ''}
  aria-pressed={drawingMode}
  title={t('trendLine')}
  onClick={() => {
    drawingStartRef.current = null
    setSelectedTrendLine(-1)
    setDrawingMode(active => !active)
  }}
>
  <svg width="14" height="14" viewBox="0 0 24 24" aria-hidden="true">
    <line x1="4" y1="19" x2="20" y2="5" />
    <circle cx="4" cy="19" r="2" />
    <circle cx="20" cy="5" r="2" />
  </svg>
  {t('trendLine')}
</button>
```

Add translation keys:

```js
// en
trendLine: 'Trend Line',

// zh
trendLine: '趨勢線',
```

- [ ] **Step 6: Run the component test and verify GREEN**

Run:

```bash
cd frontend
npm test -- component/StockChart.test.jsx
```

Expected: the creation/persistence/deletion test passes.

- [ ] **Step 7: Commit**

```bash
git add frontend/component/StockChart.jsx frontend/component/StockChart.test.jsx frontend/src/i18n/translations.js
git commit -m "Add trend line chart interactions"
```

### Task 4: Minimal styling and full verification

**Files:**

- Modify: `frontend/component/StockChart.css`

- [ ] **Step 1: Add button and cursor styles**

```css
#trend-line-btn {
  display: flex;
  align-items: center;
  gap: var(--space-1);
  padding: 6px 12px;
  background: var(--bg-panel);
  color: var(--text-secondary);
  border: 1px solid var(--border-subtle);
  border-radius: var(--radius-md);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
}

#trend-line-btn:hover,
#trend-line-btn.active {
  color: var(--warning);
  border-color: var(--warning);
  background: var(--warning-dim);
}

#trend-line-btn svg {
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
}

#lw-chart-container.drawing-trend-line {
  cursor: crosshair;
}
```

Toggle the class from `StockChart.jsx`:

```js
useEffect(() => {
  containerRef.current?.classList.toggle('drawing-trend-line', drawingMode)
}, [drawingMode])
```

- [ ] **Step 2: Run focused tests**

Run:

```bash
cd frontend
npm test -- component/trendLines.test.js component/StockChart.test.jsx
```

Expected: all focused tests pass.

- [ ] **Step 3: Run all frontend checks**

Run:

```bash
cd frontend
npm test
npm run lint
npm run build
```

Expected: all tests pass, ESLint exits 0, and Vite completes the production build.

- [ ] **Step 4: Inspect the final diff**

Run:

```bash
git diff --check
git status --short
```

Expected: no whitespace errors; only the planned implementation files and the untracked visual-companion directory are present.

- [ ] **Step 5: Commit**

```bash
git add frontend/component/StockChart.css frontend/component/StockChart.jsx
git commit -m "Style trend line drawing mode"
```

Skipped: endpoint dragging, color controls, undo/redo, server sync. Add only when users ask for editing rather than simple marking.
