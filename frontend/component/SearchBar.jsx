
import React, { useState } from 'react';
import './searchBar.css';

function SearchBar({ onStockSelect, loading }) {
    const [searchTerm, setSearchTerm] = useState('');

    const handleInputChange = (e) => {
        setSearchTerm(e.target.value.toUpperCase());
    };

    const submit = () => {
        const trimmed = searchTerm.trim();
        if (trimmed.length > 0 && onStockSelect) {
            onStockSelect({ symbol: trimmed });
            setSearchTerm('');
        }
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            submit();
        }
    };

    return (
        <div className="search-bar">
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
        </div>
    );
}

export default SearchBar;
