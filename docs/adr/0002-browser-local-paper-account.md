# Keep the fallback Paper Account in browser storage

When IB Gateway or TWS is unavailable, orders route to a simulated Paper Account persisted in browser `localStorage`. Paper state remains strictly separate from Live Accounts and never migrates or synchronizes to IB; this keeps fallback trading local and usable without introducing backend identity or persistence, at the cost of device-local state and no execution while the app is closed.
