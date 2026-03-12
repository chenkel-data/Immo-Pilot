/**
 * Custom hook for toast notifications (multiple simultaneous toasts).
 */
import { useState, useCallback, useRef } from 'react';
import { TOAST_DURATION } from '../constants.js';

let nextId = 0;

export function useToast() {
  const [toasts, setToasts] = useState([]);
  const timersRef = useRef({});

  const hideToast = useCallback((id) => {
    clearTimeout(timersRef.current[id]);
    delete timersRef.current[id];
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  /**
   * @param {string} msg
   * @param {'info'|'success'|'error'} type
   * @param {{ duration?: number, action?: { label: string, onClick: () => void } }} opts
   */
  const showToast = useCallback((msg, type = 'info', opts = {}) => {
    const id = ++nextId;
    const duration = opts?.duration ?? TOAST_DURATION;
    const action = opts?.action ?? null;
    setToasts((prev) => [...prev, { id, msg, type, action }]);

    timersRef.current[id] = setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
      delete timersRef.current[id];
    }, duration);

    return id;
  }, []);

  return { toasts, showToast, hideToast };
}
