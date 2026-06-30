"use client";
import { splitPrompts } from "@/core";

export function useSplit() {
  const extract = (input: string, apiKey: string, model: string) =>
    splitPrompts(input, { apiKey, model });
  return { extract };
}
