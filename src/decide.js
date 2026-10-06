// Combines the local rule with Gemini's opinion. "Safe to remove" needs both: a local rule with hard evidence
// (a cache path, an unfinished download, a byte-for-byte duplicate) and Gemini agreeing. Gemini alone can only say "your call".
export function decide(item, ai) {
  if (ai && ["remove", "review", "keep"].includes(ai.verdict)) {
    const confidence = Math.max(0, Math.min(1, Number(ai.confidence) || 0));
    let verdict = ai.verdict;
    if (verdict === "remove" && (item.verdict !== "remove" || item.sensitive)) verdict = "review";
    return { verdict, confidence, category: ai.category || item.category, reason: ai.reason || item.reason };
  }
  if (item.verdict === "unknown") return { verdict: "keep" };
  const verdict = item.verdict === "remove" && item.sensitive ? "review" : item.verdict;
  return { verdict, confidence: verdict === "remove" ? 0.8 : 0.5, category: item.category, reason: item.reason };
}
