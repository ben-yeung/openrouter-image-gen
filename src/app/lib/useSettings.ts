"use client";
import { useEffect, useState } from "react";
import { DEFAULT_SPLIT_MODEL } from "@/core";

const SPLIT_MODEL_KEY = "openrouter_split_model";

export function useSettings() {
  const [splitModel, setModel] = useState(DEFAULT_SPLIT_MODEL);

  useEffect(() => {
    const stored = localStorage.getItem(SPLIT_MODEL_KEY);
    if (stored) setModel(stored);
  }, []);

  const setSplitModel = (m: string) => {
    const value = m.trim() || DEFAULT_SPLIT_MODEL;
    localStorage.setItem(SPLIT_MODEL_KEY, value);
    setModel(value);
  };

  return { splitModel, setSplitModel };
}
