
import React, { useState, useEffect, useRef } from 'react';
import './searchBar.css';

function SearchBar({ onStockSelect, loading }) {
    const [searchTerm, setSearchTerm] = useState('');
    const [suggestions, setSuggestions] = useState([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [highlightedIndex, setHighlightedIndex] = useState(-1);
    const debounceTimer = useRef(null);
    const suggestionsRef = useRef(null);

    // Debounced fetch for suggestions
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
            } catch (error) {
                console.error('Error fetching suggestions:', error);
                setSuggestions([]);
            }
        }, 300); // 300ms debounce

        return () => {
            if (debounceTimer.current) {
                clearTimeout(debounceTimer.current);
            }
        };
    }, [searchTerm]);

    const handleInputChange = (e) => {
        setSearchTerm(e.target.value.toUpperCase());
    };

    const selectSuggestion = (symbol) => {
        if (onStockSelect) {
            onStockSelect({ symbol });
        }
        setSearchTerm('');
        setSuggestions([]);
        setShowSuggestions(false);
        setHighlightedIndex(-1);
    };

    const submit = () => {
        const trimmed = searchTerm.trim();
        if (trimmed.length > 0 && onStockSelect) {
            onStockSelect({ symbol: trimmed });
            setSearchTerm('');
            setSuggestions([]);
            setShowSuggestions(false);
            setHighlightedIndex(-1);
        }
    };

    const handleKeyDown = (e) => {
        if (!showSuggestions || suggestions.length === 0) {
            if (e.key === 'Enter') {
                e.preventDefault();
                submit();
            }
            return;
        }

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setHighlightedIndex(prev =>
                    prev < suggestions.length - 1 ? prev + 1 : prev
                );
                break;
            case 'ArrowUp':
                e.preventDefault();
                setHighlightedIndex(prev => (prev > 0 ? prev - 1 : -1));
                break;
            case 'Enter':
                e.preventDefault();
                if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
                    selectSuggestion(suggestions[highlightedIndex].symbol);
                } else {
                    submit();
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

    const handleClickOutside = (e) => {
        if (suggestionsRef.current && !suggestionsRef.current.contains(e.target)) {
            setShowSuggestions(false);
        }
    };

    useEffect(() => {
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    return (
        <div className="search-bar" ref={suggestionsRef}>
            <div className="search-bar-inner">
                {/* Search icon */}
                <svg className="search-icon" width="15" height="15" viewBox="0 0 24 24" fill="none"
                    stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                    <circle cx="11" cy="11" r="8"/>
                    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
                </svg>

                <input
                    type="text"
                    placeholder="Search ticker (AAPL, TSLA…)"
                    value={searchTerm}
                    onChange={handleInputChange}
                    onKeyDown={handleKeyDown}
                    onFocus={() => searchTerm.trim().length > 0 && setShowSuggestions(true)}
                    autoComplete="off"
                    spellCheck={false}
                    aria-label="Search stock ticker"
                    disabled={loading}
                />

                {loading ? (
                    <span className="search-spinner" aria-label="Loading" />
                ) : (
                    searchTerm.length > 0 && (
                        <button
                            className="search-submit-btn"
                            onClick={submit}
                            tabIndex={0}
                            aria-label="Search"
                        >
                            GO
                        </button>
                    )
                )}
            </div>

            {/* Suggestions dropdown */}
            {showSuggestions && suggestions.length > 0 && (
                <div className="search-suggestions">
                    {suggestions.map((item, index) => (
                        <div
                            key={`${item.symbol}-${index}`}
                            className={`suggestion-item ${index === highlightedIndex ? 'highlighted' : ''}`}
                            onClick={() => selectSuggestion(item.symbol)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                        >
                            <div className="suggestion-symbol">{item.symbol}</div>
                            <div className="suggestion-description">{item.description}</div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

export default SearchBar;
