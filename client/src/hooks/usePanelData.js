import { useCallback, useEffect, useState } from "react";
import api from "../api/axios";

export function usePanelData(url, pollIntervalMs = 30000) {
  const [data, setData] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const fetchData = useCallback((isInitial = false) => {
    if (isInitial) setLoading(true);
    api
      .get(url)
      .then((res) => {
        setData(res.data);
        setError("");
      })
      .catch((err) => {
        console.error(err);
        if (isInitial) setError("Data could not be loaded");
      })
      .finally(() => {
        if (isInitial) setLoading(false);
      });
  }, [url]);

  useEffect(() => {
    fetchData(true);
    if (!pollIntervalMs) return;
    const timer = setInterval(() => fetchData(false), pollIntervalMs);
    return () => clearInterval(timer);
  }, [fetchData, pollIntervalMs]);

  return { data, error, loading, refetch: fetchData };
}
