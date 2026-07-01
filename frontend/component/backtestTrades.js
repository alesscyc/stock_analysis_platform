/** Convert backtest round-trip trades into chronological BUY/SELL actions. */
export function tradesToActions(trades) {
  if (!trades?.length) return [];

  const actions = [];
  let lastEntryDate = null;
  let seq = 0;

  for (const t of trades) {
    if (t.entryDate && t.entryDate !== lastEntryDate) {
      actions.push({
        date: t.entryDate,
        side: 'BUY',
        price: t.entryPrice,
        pnl: null,
        seq: seq++,
      });
      lastEntryDate = t.entryDate;
    }
    actions.push({
      date: t.exitDate,
      side: 'SELL',
      price: t.exitPrice,
      pnl: t.pnl,
      seq: seq++,
    });
  }

  return actions.sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate !== 0) return byDate;
    return a.seq - b.seq;
  });
}
