export interface TranscriptSegment {
  start: string; // HH:MM:SS.mmm
  end: string;
  speaker: string | null;
  text: string;
}

/**
 * Teams meeting transcripts are delivered as WebVTT. Cues typically look like:
 *
 *   1
 *   00:00:03.140 --> 00:00:06.800
 *   <v Jane Doe>Let's get started, thanks everyone for joining.</v>
 *
 * This parser extracts (start, end, speaker, text) per cue. It's tolerant of
 * cues without a <v Speaker> tag (falls back to speaker: null).
 */
export function parseVtt(vtt: string): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  const blocks = vtt
    .replace(/\r/g, "")
    .split(/\n\n+/)
    .map((b) => b.trim())
    .filter(Boolean);

  const timeLineRe = /(\d{2}:\d{2}:\d{2}\.\d{3})\s*-->\s*(\d{2}:\d{2}:\d{2}\.\d{3})/;
  const speakerTagRe = /^<v\s+([^>]+)>([\s\S]*?)(<\/v>)?$/i;

  for (const block of blocks) {
    const lines = block.split("\n");
    // Skip WEBVTT header block
    if (lines[0].startsWith("WEBVTT")) continue;

    let timeLine = lines.find((l) => timeLineRe.test(l));
    if (!timeLine) continue;

    const match = timeLine.match(timeLineRe)!;
    const start = match[1];
    const end = match[2];

    const textLines = lines.slice(lines.indexOf(timeLine) + 1).join(" ").trim();
    const speakerMatch = textLines.match(speakerTagRe);

    if (speakerMatch) {
      segments.push({
        start,
        end,
        speaker: speakerMatch[1].trim(),
        text: speakerMatch[2].trim(),
      });
    } else {
      segments.push({
        start,
        end,
        speaker: null,
        text: textLines.replace(/<\/?v[^>]*>/g, "").trim(),
      });
    }
  }

  return segments;
}

/** Renders parsed segments as a readable "Speaker: text" transcript. */
export function segmentsToPlainText(segments: TranscriptSegment[]): string {
  return segments
    .map((s) => `[${s.start}] ${s.speaker ?? "Unknown"}: ${s.text}`)
    .join("\n");
}
