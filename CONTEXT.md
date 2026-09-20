# Stock Analysis Platform

Local workspace for researching stocks and routing either live or simulated trades.

## Language

**Live Account**:
Account reached through a connected IB Gateway or TWS.
_Avoid_: IB account

**Paper Account**:
Browser-local, USD-denominated simulated cash account, separate from every Live Account and from IB's own paper-trading accounts.
_Avoid_: Offline account, IB paper account

**Active Account**:
Live Account or Paper Account currently shown and used for user-confirmed order routing and AI context.
_Avoid_: Selected account

**Live Mode**:
Trading mode that makes a Live Account active and routes orders to it. It is the initial mode when IB Gateway or TWS is connected.
_Avoid_: IB mode

**Paper Mode**:
Trading mode that makes the Paper Account active and routes orders to it. It activates automatically when IB Gateway or TWS is disconnected, while an explicit mode preference remains unchanged.
_Avoid_: Offline mode

**Paper Order**:
Simulated order belonging only to the Paper Account. It is never submitted, migrated, or synchronized to a Live Account.
_Avoid_: Offline order
