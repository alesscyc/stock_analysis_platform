import { useState, useEffect, useRef, useCallback } from 'react';
import './WatchlistDialog.css';

const STORAGE_KEY = 'stockai-watchlist';

function loadWatchlist() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveWatchlist(list) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

function WatchlistDialog({ isOpen, onClose, onStockSelect }) {
  const [watchlist, setWatchlist] = useState(loadWatchlist);
  const [searchTerm, setSearchTerm] = useState('');
  const [suggestions, setSuggestions] = useState([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [prices, setPrices] = useState({});
  const [pricesLoading, setPricesLoading] = useState(false);
  const debounceTimer = useRef(null);
  const suggestionsRef = useRef(null);
  const inputRef = useRef(null);

  // Persist watchlist changes
  useEffect(() => {
    saveWatchlist(watchlist);
  }, [watchlist]);

  // Fetch prices for all watchlist items when dialog opens
  useEffect(() => {
    if (!isOpen || watchlist.length === 0) return;

    let active = true;
    setPricesLoading(true);

    const fetchPrices = async () => {
      const results = {};
      await Promise.all(
        watchlist.map(async (item) => {
          try {
            const res = await fetch(
              `/api/stock/${item.symbol}?date_range=1d&interval=1d&auto_predict=false`
            );
            const data = await res.json();
            if (Array.isArray(data) && data.length > 0) {
              const last = [...data].reverse().find((d) => d.Close != null);
              if (last) {
                results[item.symbol] = Math.round(parseFloat(last.Close) * 100) / 100;
              }
            }
          } catch {
            // Skip failed price fetches silently
          }
        })
      );
      if (active) {
        setPrices(results);
        setPricesLoading(false);
      }
    };

    fetchPrices();
    return () => { active = false; };
  }, [isOpen, watchlist]);

  // Debounced symbol search
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (searchTerm.trim().length === 0) {
      setSuggestions([]);
      setShowSuggestions(false);
      setHighlightedIndex(-1);
      return;
    }

    debounceTimer.current = setTimeout(async () => {
      try {
        const response = await fetch(
          `/api/symbols?q=${encodeURIComponent(searchTerm)}`
        );
        const data = await response.json();
        setSuggestions(Array.isArray(data) ? data : []);
        setShowSuggestions(true);
        setHighlightedIndex(-1);
      } catch {
        setSuggestions([]);
      }
    }, 300);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [searchTerm]);

  // Click outside to close suggestions
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (suggestionsRef.current && !suggestionsRef.current.contains(e.target)) {
        setShowSuggestions(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const addToWatchlist = useCallback((symbol, description) => {
    setWatchlist((prev) => {
      if (prev.some((item) => item.symbol === symbol)) return prev;
      return [...prev, { symbol, description }];
    });
    setSearchTerm('');
    setSuggestions([]);
    setShowSuggestions(false);
    setHighlightedIndex(-1);
  }, []);

  const removeFromWatchlist = useCallback((symbol) => {
    setWatchlist((prev) => prev.filter((item) => item.symbol !== symbol));
    setPrices((prev) => {
      const next = { ...prev };
      delete next[symbol];
      return next;
    });
  }, []);

  const handleSelectSuggestion = useCallback((item) => {
    addToWatchlist(item.symbol, item.description);
  }, [addToWatchlist]);

  const handleWatchlistItemClick = useCallback((item) => {
    if (onStockSelect) {
      onStockSelect({ symbol: item.symbol });
    }
    onClose();
  }, [onStockSelect, onClose]);

  const handleKeyDown = (e) => {
    if (!showSuggestions || suggestions.length === 0) {
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        setHighlightedIndex(-1);
      }
      // No Enter-to-add — user must click autocomplete
      return;
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < suggestions.length - 1 ? prev + 1 : prev
        );
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : -1));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
          handleSelectSuggestion(suggestions[highlightedIndex]);
        }
        break;
      case 'Escape':
        e.preventDefault();
        setShowSuggestions(false);
        setHighlightedIndex(-1);
        break;
      default:
        break;
    }
  };

  const handleClose = () => {
    setSearchTerm('');
    setSuggestions([]);
    setShowSuggestions(false);
    setHighlightedIndex(-1);
    onClose();
  };

  if (!isOpen) return null;

  return (
    <>
      <div id="watchlist-dialog-backdrop" onClick={handleClose} />

      <div id="watchlist-dialog-sidebar" role="dialog" aria-modal="true" aria-label="Watchlist">

        {/* Header */}
        <div id="watchlist-dialog-header">
          <div id="watchlist-header-left">
            <div id="watchlist-type-badge">WATCHLIST</div>
            <h2 id="watchlist-dialog-title">Watchlist</h2>
          </div>
          <button id="watchlist-dialog-close-btn" onClick={handleClose} aria-label="Close watchlist">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
              <line x1="18" y1="6" x2="6" y2="18"/>
              <line x1="6" y1="6" x2="18" y2="18"/>
            </svg>
          </button>
        </div>

        {/* Search field with autocomplete */}
        <div className="watchlist-search-area" ref={suggestionsRef}>
          <div className="watchlist-search-inner">
            <svg className="watchlist-search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="11" cy="11" r="8"/>
              <line x1="21" y1="21" x2="16.65" y2="16.65"/>
            </svg>
            <input
              ref={inputRef}
              type="text"
              placeholder="Add symbol to watchlist…"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value.toUpperCase())}
              onKeyDown={handleKeyDown}
              onFocus={() => searchTerm.trim().length > 0 && suggestions.length > 0 && setShowSuggestions(true)}
              autoComplete="off"
              spellCheck={false}
              aria-label="Search symbol to add to watchlist"
            />
          </div>

          {/* Autocomplete dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="watchlist-suggestions">
              {suggestions.map((item, index) => (
                <div
                  key={`${item.symbol}-${index}`}
                  className={`watchlist-suggestion-item ${index === highlightedIndex ? 'highlighted' : ''} ${watchlist.some(w => w.symbol === item.symbol) ? 'already-added' : ''}`}
                  onClick={() => handleSelectSuggestion(item)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                >
                  <div className="watchlist-suggestion-symbol">{item.symbol}</div>
                  <div className="watchlist-suggestion-description">{item.description}</div>
                  {watchlist.some(w => w.symbol === item.symbol) && (
                    <span className="watchlist-suggestion-badge">Added</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Watchlist items */}
        {watchlist.length === 0 ? (
          <div id="watchlist-empty-state">
            <div className="watchlist-empty-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 2L3 7v6c0 5.55 3.84 10.74 9 12 5.16-1.26 9-6.45 9-12V7l-9-5z"/>
              </svg>
            </div>
            <span className="watchlist-empty-title">No symbols watched</span>
            <span className="watchlist-empty-sub">Search for a ticker above and click a result to add it to your watchlist.</span>
          </div>
        ) : (
          <div id="watchlist-list">
            {pricesLoading && (
              <div id="watchlist-prices-loading">
                <span className="watchlist-spinner" />
                <span>Loading prices…</span>
              </div>
            )}
            {watchlist.map((item) => (
              <div
                key={item.symbol}
                className="watchlist-item"
                onClick={() => handleWatchlistItemClick(item)}
                title={`Load ${item.symbol} chart`}
              >
                <div className="watchlist-item-info">
                  <span className="watchlist-item-symbol">{item.symbol}</span>
                  <span className="watchlist-item-desc">{item.description}</span>
                </div>
                <div className="watchlist-item-right">
                  {prices[item.symbol] != null && (
                    <span className="watchlist-item-price">
                      ${prices[item.symbol].toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    </span>
                  )}
                  <button
                    className="watchlist-item-remove"
                    onClick={(e) => { e.stopPropagation(); removeFromWatchlist(item.symbol); }}
                    aria-label={`Remove ${item.symbol}`}
                    title={`Remove ${item.symbol}`}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                      <line x1="18" y1="6" x2="6" y2="18"/>
                      <line x1="6" y1="6" x2="18" y2="18"/>
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

export default WatchlistDialog;
