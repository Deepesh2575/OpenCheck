import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const maxDuration = 30;

const MAX_TEXT_LENGTH = 20_000;

export async function POST(request: NextRequest) {
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json(
      { error: "Style-review requests must use application/json." },
      { status: 415 },
    );
  }
  const contentLength = Number(request.headers.get("content-length") ?? 0);
  if (contentLength > MAX_TEXT_LENGTH + 4096) {
    return NextResponse.json({ error: "The style-review request is too large." }, { status: 413 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (
    typeof payload !== "object" ||
    payload === null ||
    !("text" in payload) ||
    !("apiKey" in payload) ||
    typeof payload.text !== "string" ||
    typeof payload.apiKey !== "string" ||
    payload.text.trim().length < 100 ||
    payload.text.length > MAX_TEXT_LENGTH ||
    payload.apiKey.length < 20 ||
    payload.apiKey.length > 512 ||
    /[\r\n]/u.test(payload.apiKey)
  ) {
    return NextResponse.json(
      { error: "Provide at least 100 characters of text and a valid Gemini API key (maximum 20,000 characters)." },
      { status: 400 },
    );
  }

  const apiKey = payload.apiKey;
  const text = payload.text;
  const model = "gemini-2.5-flash";
  const url = new URL(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
  );

  let response: Response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: {
          parts: [{
            text:
              "You provide a highly limited experimental AI-writing signal, not forensic detection. " +
              "Do not state or imply that you know who wrote the text. Choose signals_observed only " +
              "when multiple conspicuous patterns commonly associated with generated prose are " +
              "present; choose no_clear_signals when they are not; choose inconclusive when there " +
              "isn't enough evidence. Never assign a probability, percentage, verdict, or claim of " +
              "proof. Describe observable style patterns only, and state that human and AI writing overlap.",
          }],
        },
        contents: [{ role: "user", parts: [{ text: `Assess only whether this text shows observable patterns sometimes associated with AI-generated prose. This is an experimental, unreliable signal, not proof of authorship. Return inconclusive if evidence is weak. Do not write an AI-generated verdict.\n\n${text}` }] }],
        generationConfig: {
          temperature: 0.2,
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: {
              assessment: {
                type: "STRING",
                enum: ["signals_observed", "no_clear_signals", "inconclusive"],
              },
              summary: { type: "STRING" },
              signals: { type: "ARRAY", items: { type: "STRING" } },
              caveat: { type: "STRING" },
            },
            required: ["assessment", "summary", "signals", "caveat"],
          },
        },
      }),
      signal: AbortSignal.timeout(25_000),
      cache: "no-store",
    });
  } catch {
    return NextResponse.json(
      { error: "Could not reach Gemini. Check your connection and try again." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  if (!response.ok) {
    const status = response.status === 400 || response.status === 403 ? 400 : 502;
    return NextResponse.json(
      { error: `Gemini returned HTTP ${response.status}. Verify your API key, quota, and model access.` },
      { status, headers: { "Cache-Control": "no-store" } },
    );
  }

  let result: unknown;
  try {
    result = await response.json();
  } catch {
    return NextResponse.json(
      { error: "Gemini returned an invalid response." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  const candidate =
    typeof result === "object" && result !== null && "candidates" in result &&
    Array.isArray(result.candidates)
      ? result.candidates[0]
      : null;
  const content =
    typeof candidate === "object" && candidate !== null && "content" in candidate
      ? candidate.content
      : null;
  const parts =
    typeof content === "object" && content !== null && "parts" in content &&
    Array.isArray(content.parts)
      ? content.parts
      : [];
  const responseText =
    typeof parts[0] === "object" && parts[0] !== null && "text" in parts[0] &&
    typeof parts[0].text === "string"
      ? parts[0].text
      : "";
  try {
    const review: unknown = JSON.parse(responseText);
    if (
      typeof review !== "object" ||
      review === null ||
      !("assessment" in review) ||
      !["signals_observed", "no_clear_signals", "inconclusive"].includes(String(review.assessment)) ||
      !("summary" in review) ||
      typeof review.summary !== "string" ||
      review.summary.length > 1000 ||
      !("signals" in review) ||
      !Array.isArray(review.signals) ||
      review.signals.length > 3 ||
      !review.signals.every((signal) => typeof signal === "string" && signal.length <= 500) ||
      !("caveat" in review) ||
      typeof review.caveat !== "string" ||
      review.caveat.length > 1000
    ) {
      throw new Error("Invalid review structure");
    }
    return NextResponse.json(
      { review },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Gemini returned an invalid style-review result." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
