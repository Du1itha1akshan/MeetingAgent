import Anthropic from "@anthropic-ai/sdk";
import { getConfig } from "../config";

export interface ActionItem {
  description: string;
  owner: string | null;
  due_date: string | null;
}

export interface MeetingSummary {
  title: string;
  overview: string;
  key_points: string[];
  decisions: string[];
  action_items: ActionItem[];
  open_questions: string[];
}

let clientPromise: Promise<Anthropic> | null = null;

async function getClient(): Promise<Anthropic> {
  if (!clientPromise) {
    clientPromise = getConfig().then((config) => new Anthropic({ apiKey: config.claude.apiKey }));
  }
  return clientPromise;
}

const SYSTEM_PROMPT = `You turn raw meeting transcripts into structured meeting documentation.
Be faithful to the transcript: never invent action items, owners, or decisions that
aren't clearly supported by what was said. If a field has no supported content,
return an empty array or null rather than guessing.
Respond with ONLY a JSON object matching this exact shape, no prose, no markdown fences:

{
  "title": string,
  "overview": string,        // 2-4 sentence summary of what the meeting covered
  "key_points": string[],    // notable discussion points, concise
  "decisions": string[],     // concrete decisions that were made
  "action_items": [
    { "description": string, "owner": string | null, "due_date": string | null }
  ],
  "open_questions": string[] // unresolved questions or items needing follow-up
}`;

export async function summarizeTranscript(
  meetingSubject: string,
  transcriptPlainText: string
): Promise<MeetingSummary> {
  const [client, config] = await Promise.all([getClient(), getConfig()]);
  const message = await client.messages.create({
    model: config.claude.model,
    max_tokens: 4000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: `Meeting subject: ${meetingSubject}\n\nTranscript:\n${transcriptPlainText}`,
      },
    ],
  });

  const textBlock = message.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error("Claude response contained no text block");
  }

  const cleaned = textBlock.text.trim().replace(/^```json\s*|\s*```$/g, "");

  let parsed: MeetingSummary;
  try {
    parsed = JSON.parse(cleaned);
  } catch (err) {
    throw new Error(
      `Failed to parse Claude summary as JSON: ${err}\nRaw: ${cleaned.slice(0, 500)}`
    );
  }

  return {
    title: parsed.title ?? meetingSubject,
    overview: parsed.overview ?? "",
    key_points: parsed.key_points ?? [],
    decisions: parsed.decisions ?? [],
    action_items: parsed.action_items ?? [],
    open_questions: parsed.open_questions ?? [],
  };
}
