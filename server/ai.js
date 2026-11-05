// Calls the Gemini API and returns parsed JSON. The key goes in a header, so it
// never appears in a URL or an error message. Free models get busy, so each try
// has a time limit and a busy model falls through to a lighter one.
const DEFAULT_MODEL = 'gemini-3.5-flash';
const FALLBACK_MODELS = ['gemini-3.5-flash-lite', 'gemini-flash-lite-latest'];
const RETRY_STATUS = new Set([404, 429, 500, 503]);

export async function generateJSON({ system, user, apiKey, model, fetchImpl = fetch, timeoutMs = 30000 }) {
  const models = [...new Set([model || DEFAULT_MODEL, ...FALLBACK_MODELS])];
  let lastError = 'No model answered';
  for (const name of models) {
    let res;
    try {
      res = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${name}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(timeoutMs),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: user }] }],
          generationConfig: { responseMimeType: 'application/json' },
        }),
      });
    } catch (err) {
      lastError = `Gemini ${name} did not answer (${err.name})`;
      continue;
    }
    if (!res.ok) {
      const detail = await res.json().catch(() => ({}));
      lastError = `Gemini ${name} answered ${res.status}: ${String(detail.error?.message ?? '').slice(0, 120)}`;
      if (RETRY_STATUS.has(res.status)) continue;
      throw new Error(lastError);
    }
    const data = await res.json();
    const text = data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('');
    if (!text) throw new Error(`Gemini returned no text (${data.candidates?.[0]?.finishReason ?? data.promptFeedback?.blockReason ?? 'unknown'})`);
    return JSON.parse(text);
  }
  throw new Error(lastError);
}
