const pad = value => String(value).padStart(2, '0')

function formatUtcDate(date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`
}

export function shiftYears(dateString, years) {
  const date = new Date(`${dateString}T00:00:00Z`)
  const month = date.getUTCMonth()
  const day = date.getUTCDate()
  const year = date.getUTCFullYear() + years
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate()
  return formatUtcDate(new Date(Date.UTC(year, month, Math.min(day, lastDay))))
}

export function recentDailyWindow(now = new Date()) {
  const end = new Date(now)
  end.setUTCDate(end.getUTCDate() + 1)
  const endDate = formatUtcDate(end)
  return { startDate: shiftYears(endDate, -2), endDate }
}

export function olderDailyWindow(beforeDate) {
  return { startDate: shiftYears(beforeDate, -5), endDate: beforeDate }
}

export function mergeStockData(...groups) {
  const rows = new Map()
  for (const group of groups) {
    for (const row of group || []) {
      if (row?.Date) rows.set(row.Date, row)
    }
  }
  return [...rows.values()].sort((a, b) => a.Date.localeCompare(b.Date))
}
