import { describe, expect, it } from 'vitest'
import { mergeStockData, olderDailyWindow, recentDailyWindow, shiftYears } from './chartLoading'

describe('chart loading helpers', () => {
  it('merges backfill in date order and lets refreshed rows win', () => {
    const older = [{ Date: '2024-01-01', Close: 10 }, { Date: '2025-01-01', Close: 20 }]
    const recent = [{ Date: '2025-01-01', Close: 21 }, { Date: '2026-01-01', Close: 30 }]

    expect(mergeStockData(older, recent)).toEqual([
      { Date: '2024-01-01', Close: 10 },
      { Date: '2025-01-01', Close: 21 },
      { Date: '2026-01-01', Close: 30 },
    ])
  })

  it('builds two-year initial and five-year backfill windows', () => {
    expect(recentDailyWindow(new Date('2026-08-11T12:00:00Z'))).toEqual({
      startDate: '2024-08-12',
      endDate: '2026-08-12',
    })
    expect(olderDailyWindow('2024-08-12')).toEqual({
      startDate: '2019-08-12',
      endDate: '2024-08-12',
    })
    expect(shiftYears('2024-02-29', -1)).toBe('2023-02-28')
  })
})
