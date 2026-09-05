import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it } from 'vitest'
import { I18nProvider } from '../src/i18n/I18nContext.jsx'
import TradeDialog from './TradeDialog'

it('defaults to the latest price on open, preserves edits, and prioritizes explicit draft prices', () => {
  const ticket = (props = {}) => <I18nProvider>
    <TradeDialog isOpen stockSymbol="AAPL" currentPrice={123.45} {...props} />
  </I18nProvider>
  const { rerender } = render(ticket())
  expect(screen.getByLabelText('Price (USD)')).toHaveValue(123.45)
  fireEvent.change(screen.getByLabelText('Price (USD)'), { target: { value: '120' } })
  rerender(ticket({ currentPrice: 125 }))
  expect(screen.getByLabelText('Price (USD)')).toHaveValue(120)
  rerender(ticket({ isOpen: false, currentPrice: 125 }))
  rerender(ticket({ currentPrice: 125 }))
  expect(screen.getByLabelText('Price (USD)')).toHaveValue(125)
  rerender(ticket({ draft: { orderType: 'LMT', limitPrice: 110 } }))
  expect(screen.getByLabelText('Price (USD)')).toHaveValue(110)
})
