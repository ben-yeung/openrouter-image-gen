"use client";
import { splitPromptsHeuristic, splitPromptsLLM } from "@/core";

export function useSplit() {
  const detect = (input: string) => splitPromptsHeuristic(input);
  const aiSplit = (input: string, apiKey: string, model: string) =>
    splitPromptsLLM(input, { apiKey, model });
  return { detect, aiSplit };
}
