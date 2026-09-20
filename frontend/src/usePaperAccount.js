import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isGitHubPages } from './environment';
import {
  PAPER_ACCOUNT_KEY,
  PaperAccountError,
  applyPaperQuote,
  buildPaperOverview,
  cancelPaperOrder,
  createPaperAccount,
  expirePaperOrders,
  getOpenPaperOrders,
  getPaperOrderHistory,
  loadPaperAccount,
  modifyPaperOrder,
  savePaperAccount,
  submitPaperOrder,
} from './paperAccount';

const PRIMARY_KEY = 'stockai-paper-account-primary';
const HEARTBEAT_MS = 3000;
const PRIMARY_TIMEOUT_MS = 8000;
const QUOTE_POLL_MS = 30000;

const makeTabId = () => globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`;

export default function usePaperAccount() {
  const tabId = useRef(makeTabId());
  const lockUnavailable = !navigator.locks?.request;
  const [account, setAccount] = useState(null);
  const [error, setError] = useState(null);
  const [isPrimary, setIsPrimary] = useState(false);

  const readOwner = useCallback(() => {
    try {
      return JSON.parse(localStorage.getItem(PRIMARY_KEY) || 'null');
    } catch {
      return null;
    }
  }, []);

  const claimPrimary = useCallback(() => {
    const owner = readOwner();
    const now = Date.now();
    if (owner?.id !== tabId.current && now - Number(owner?.at || 0) < PRIMARY_TIMEOUT_MS) {
      setIsPrimary(false);
      return false;
    }
    try {
      localStorage.setItem(PRIMARY_KEY, JSON.stringify({ id: tabId.current, at: now }));
      const won = readOwner()?.id === tabId.current;
      setIsPrimary(won);
      return won;
    } catch {
      setError('Browser storage is unavailable');
      setIsPrimary(false);
      return false;
    }
  }, [readOwner]);

  useEffect(() => {
    const currentTabId = tabId.current;
    try {
      setAccount(loadPaperAccount());
      setError(null);
    } catch (loadError) {
      setError(loadError.message);
    }
    claimPrimary();
    const timer = setInterval(claimPrimary, HEARTBEAT_MS);
    return () => {
      clearInterval(timer);
      try {
        if (readOwner()?.id === currentTabId) localStorage.removeItem(PRIMARY_KEY);
      } catch { /* storage already unavailable */ }
    };
  }, [claimPrimary, readOwner]);

  useEffect(() => {
    const onStorage = (event) => {
      if (event.key === PAPER_ACCOUNT_KEY) {
        try {
          setAccount(loadPaperAccount());
          setError(null);
        } catch (loadError) {
          setError(loadError.message);
        }
      }
      if (event.key === PRIMARY_KEY) claimPrimary();
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [claimPrimary]);

  const commit = useCallback(async (update) => {
    const write = () => {
      if (!claimPrimary()) throw new PaperAccountError('Paper Account is read-only in this tab');
      if (error) throw new PaperAccountError(error);
      let current;
      try {
        current = loadPaperAccount();
      } catch (storageError) {
        setError(storageError.message);
        throw storageError;
      }
      const next = update(current);
      try {
        savePaperAccount(next);
      } catch (storageError) {
        setError(storageError.message);
        throw storageError;
      }
      setAccount(next);
      setError(null);
      return next;
    };
    if (lockUnavailable) throw new PaperAccountError('Paper trading requires browser lock support');
    return navigator.locks.request('stockai-paper-account', { mode: 'exclusive' }, write);
  }, [claimPrimary, error, lockUnavailable]);

  const fetchQuote = useCallback(async (symbol) => {
    if (isGitHubPages()) throw new PaperAccountError('Paper trading requires the local backend');
    const response = await fetch(`/api/price/${encodeURIComponent(symbol)}`);
    const data = await response.json();
    if (!response.ok || !Number.isFinite(Number(data?.price)) || Number(data.price) <= 0) {
      throw new PaperAccountError(data?.error || 'Quote unavailable');
    }
    return Number(data.price);
  }, []);

  const submit = useCallback(async (payload) => {
    let quote = null;
    try { quote = await fetchQuote(payload.symbol); } catch { /* resting orders may remain pending */ }
    let result;
    await commit((current) => {
      const submitted = submitPaperOrder(current, payload, quote);
      result = submitted.result;
      return submitted.account;
    });
    return result;
  }, [commit, fetchQuote]);

  const modify = useCallback(async (orderRef, price) => {
    const next = await commit((current) => modifyPaperOrder(current, orderRef, price));
    const order = next.orders.find((row) => row.id === String(orderRef));
    return { success: true, orderId: order.id, price: order.limitPrice, ...order };
  }, [commit]);

  const cancel = useCallback(async (orderRef) => {
    await commit((current) => cancelPaperOrder(current, orderRef));
    return { success: true };
  }, [commit]);

  const reset = useCallback(async (startingCash) => {
    const write = () => {
      if (!claimPrimary()) throw new PaperAccountError('Paper Account is read-only in this tab');
      const next = createPaperAccount(startingCash);
      try {
        savePaperAccount(next);
      } catch (storageError) {
        setError(storageError.message);
        throw storageError;
      }
      setAccount(next);
      setError(null);
      return next;
    };
    if (lockUnavailable) throw new PaperAccountError('Paper trading requires browser lock support');
    return navigator.locks.request('stockai-paper-account', { mode: 'exclusive' }, write);
  }, [claimPrimary, lockUnavailable]);

  useEffect(() => {
    if (!isPrimary || error || isGitHubPages()) return undefined;
    let cancelled = false;
    const poll = async () => {
      let current;
      try { current = loadPaperAccount(); } catch { return; }
      const symbols = [...new Set([
        ...getOpenPaperOrders(current).filter((order) => order.status === 'Submitted').map((order) => order.symbol),
        ...Object.keys(current.holdings),
      ])];
      if (!symbols.length) {
        try { await commit((current) => expirePaperOrders(current)); } catch { /* surfaced through state */ }
        return;
      }
      const quotes = await Promise.all(symbols.map(async (symbol) => {
        try { return [symbol, await fetchQuote(symbol)]; } catch { return null; }
      }));
      if (cancelled) return;
      try {
        await commit((current) => quotes.filter(Boolean).reduce(
          (next, [symbol, price]) => applyPaperQuote(next, symbol, price),
          expirePaperOrders(current),
        ));
      } catch { /* surfaced through state */ }
    };
    void poll();
    const timer = setInterval(poll, QUOTE_POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [commit, error, fetchQuote, isPrimary]);

  const overview = useMemo(() => account ? buildPaperOverview(account) : null, [account]);
  return {
    overview,
    openOrders: account ? getOpenPaperOrders(account) : [],
    history: account ? getPaperOrderHistory(account) : [],
    error: error || (lockUnavailable ? 'Paper trading requires browser lock support' : null),
    isPrimary,
    canTrade: Boolean(account && !error && !lockUnavailable && isPrimary && !isGitHubPages()),
    submit,
    modify,
    cancel,
    reset,
  };
}
