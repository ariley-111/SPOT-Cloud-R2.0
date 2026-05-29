/* eslint-disable */
import { useEffect, useState, useRef } from "react";

export function useDebounce(value, delay = 350) {
  const [v, setV] = useState(value);
  const timer = useRef(null);
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setV(value), delay);
    return () => clearTimeout(timer.current);
  }, [value, delay]);
  return v;
}
