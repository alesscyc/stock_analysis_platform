
import React, { useState } from 'react';
import './searchBar.css';

function SearchBar({ onStockSelect }) {
    const [searchTerm, setSearchTerm] = useState('');

    const handleInputChange = (e) => {
        setSearchTerm(e.target.value.toUpperCase());
    };

    const handleKeyDown = (e) => {
        if (e.key === 'Enter' && searchTerm.trim().length > 0) {
            e.preventDefault();
            if (onStockSelect) {
                onStockSelect({ symbol: searchTerm.trim() });
            }
            setSearchTerm('');
        }
    };

    return (
        <div className="search-bar">
            <input
                type="text"
                placeholder="Search stocks..."
                value={searchTerm}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                autoComplete="chrome-off"
            />
        </div>
    );
}

export default SearchBar;