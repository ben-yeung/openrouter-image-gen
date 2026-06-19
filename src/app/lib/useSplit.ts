"use client";
import { splitPromptsLLM } from "@/core";

export function useSplit() {
  const extract = (input: string, apiKey: string, model: string) =>
    splitPromptsLLM(input, { apiKey, model });
  return { extract };
}
