import { useState, useEffect, useCallback } from 'react';

/**
 * Drop-in replacement for useState that persists to localStorage.
 * Survives page reloads and server restarts. Lost on browser data clear.
 *
 * @param {string} key          - localStorage key (namespace it, e.g. 'chart-ma-visibility')
 * @param {*}       defaultValue - fallback when no stored value exists
 * @returns {[any, Function]}    - same API as useState
 */
export default function usePersistedState(key, defaultValue) {
  const [value, setValue] = useState(() => {
    try {
      const stored = localStorage.getItem(key);
      return stored !== null ? JSON.parse(stored) : defaultValue;
    } catch {
      return defaultValue;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // quota exceeded or private mode — silently ignore
    }
  }, [key, value]);

  return [value, setValue];
}