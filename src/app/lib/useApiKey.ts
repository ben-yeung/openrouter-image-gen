"use client";
import { useEffect, useState } from "react";

const KEY = "openrouter_api_key";

export function useApiKey() {
  const [apiKey, setKey] = useState("");

  useEffect(() => {
    setKey(localStorage.getItem(KEY) ?? "");
  }, []);

  const setApiKey = (k: string) => {
    localStorage.setItem(KEY, k);
    setKey(k);
  };
  const clear = () => {
    localStorage.removeItem(KEY);
    setKey("");
  };

  return { apiKey, setApiKey, clear };
}
