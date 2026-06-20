# Chart Trend Line Design

## Goal

Add one persistent trend-line drawing tool to the stock chart.

## Interaction

- A **Trend Line** button in the existing chart controls toggles drawing mode.
- In drawing mode, the first chart click sets the start point and the second sets the end point.
- After the second click, drawing mode turns off so normal chart navigation resumes.
- Clicking near an existing trend line selects it.
- Pressing `Delete` or `Backspace` removes the selected line.
- Changing symbol loads that symbol's saved lines.

## Data

Each line stores two chart-space points:

```js
{
  start: { time, price },
  end: { time, price }
}
```

Lines are stored in `localStorage` under a key scoped by the uppercase stock symbol. Invalid stored data is ignored and replaced with an empty list.

## Rendering

Use one custom lightweight-charts series primitive attached to the candlestick series. It converts stored time/price points to canvas coordinates during rendering, draws all lines, highlights the selected line, and provides a small pixel-distance hit test.

The primitive follows chart pan, zoom, resize, and price-scale changes because it renders from chart-space coordinates rather than fixed screen coordinates.

## Scope

Included:

- One fixed visual style
- Two-click creation
- Selection and keyboard deletion
- Per-symbol browser persistence

Excluded:

- Dragging or editing endpoints
- Color or width controls
- Undo/redo
- Mobile-specific gestures
- Server or cross-device sync

## Verification

- Unit-test storage parsing and per-symbol persistence.
- Unit-test line hit testing.
- Component-test the two-click creation and Delete/Backspace removal flow with the chart API mocked at its boundary.
- Run the frontend test suite, lint, and production build.
