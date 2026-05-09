import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the topbar brand icon', () => {
    render(<App />)
    const brand = screen.getByText(/StockAI/i)
    expect(brand).toBeInTheDocument()
  })

  it('renders search bar placeholder', () => {
    render(<App />)
    const input = screen.getByPlaceholderText(/Search ticker/i)
    expect(input).toBeInTheDocument()
  })
})
