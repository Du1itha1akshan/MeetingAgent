import { Octokit } from "@octokit/rest";
import { createAppAuth } from "@octokit/auth-app";
import { getConfig } from "../config";
import { MeetingSummary } from "../processing/summarizer";
import { TranscriptSegment, segmentsToPlainText } from "../processing/transcriptParser";

/**
 * Authenticates as a GitHub App installation rather than a personal access
 * token. Installation tokens are minted on demand and expire in ~1 hour —
 * there is nothing to rotate by hand, which is the point: a PAT with an
 * expiration date would eventually require a person to generate a new one,
 * breaking the "runs unattended forever" property.
 */
let octokitPromise: Promise<Octokit> | null = null;

async function getOctokit(): Promise<Octokit> {
  if (!octokitPromise) {
    octokitPromise = getConfig().then(
      (config) =>
        new Octokit({
          authStrategy: createAppAuth,
          auth: {
            appId: config.github.appId,
            privateKey: config.github.appPrivateKey,
            installationId: config.github.installationId,
          },
        })
    );
  }
  return octokitPromise;
}

function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

async function upsertFile(path: string, content: string, message: string) {
  const octokit = await getOctokit();
  const config = await getConfig();
  const { owner, repo, branch } = config.github;

  let sha: string | undefined;
  try {
    const existing = await octokit.repos.getContent({ owner, repo, path, ref: branch });
    if (!Array.isArray(existing.data) && "sha" in existing.data) {
      sha = existing.data.sha;
    }
  } catch (err: any) {
    if (err.status !== 404) throw err; // 404 is expected for new files
  }

  await octokit.repos.createOrUpdateFileContents({
    owner,
    repo,
    branch,
    path,
    message,
    content: Buffer.from(content, "utf-8").toString("base64"),
    sha,
  });
}

function renderSummaryMarkdown(meetingDateIso: string, summary: MeetingSummary): string {
  const lines: string[] = [];
  lines.push(`# ${summary.title}`);
  lines.push("");
  lines.push(`**Date:** ${meetingDateIso}`);
  lines.push("");
  lines.push("## Overview");
  lines.push(summary.overview || "_No overview generated._");
  lines.push("");
  lines.push("## Key Points");
  lines.push(...(summary.key_points.length
    ? summary.key_points.map((p) => `- ${p}`)
    : ["_None captured._"]));
  lines.push("");
  lines.push("## Decisions");
  lines.push(...(summary.decisions.length
    ? summary.decisions.map((d) => `- ${d}`)
    : ["_None captured._"]));
  lines.push("");
  lines.push("## Open Questions");
  lines.push(...(summary.open_questions.length
    ? summary.open_questions.map((q) => `- ${q}`)
    : ["_None captured._"]));
  lines.push("");
  return lines.join("\n");
}

function renderActionItemsMarkdown(summary: MeetingSummary): string {
  const lines: string[] = [`# Action Items — ${summary.title}`, ""];
  if (!summary.action_items.length) {
    lines.push("_No action items identified._");
    return lines.join("\n");
  }
  lines.push("| Owner | Description | Due Date |");
  lines.push("|---|---|---|");
  for (const item of summary.action_items) {
    lines.push(
      `| ${item.owner ?? "Unassigned"} | ${item.description} | ${item.due_date ?? "—"} |`
    );
  }
  return lines.join("\n");
}

async function createIssuesForActionItems(
  summary: MeetingSummary,
  folderPath: string
): Promise<void> {
  const octokit = await getOctokit();
  const config = await getConfig();
  const { owner, repo } = config.github;
  for (const item of summary.action_items) {
    await octokit.issues.create({
      owner,
      repo,
      title: `[${summary.title}] ${item.description}`.slice(0, 250),
      body:
        `Action item captured from meeting **${summary.title}**.\n\n` +
        `- **Owner:** ${item.owner ?? "Unassigned"}\n` +
        `- **Due date:** ${item.due_date ?? "Not specified"}\n\n` +
        `See full notes: \`${folderPath}/summary.md\``,
      labels: ["meeting-action-item"],
    });
  }
}

export async function publishMeetingDocs(params: {
  meetingSubject: string;
  meetingDateIso: string;
  segments: TranscriptSegment[];
  summary: MeetingSummary;
}): Promise<{ folderPath: string }> {
  const config = await getConfig();
  const dateStr = params.meetingDateIso.slice(0, 10); // YYYY-MM-DD
  const folderName = `${dateStr}-${slugify(params.meetingSubject)}`;
  const folderPath = `${config.github.basePath}/${folderName}`;

  const transcriptText = segmentsToPlainText(params.segments);

  await upsertFile(
    `${folderPath}/transcript.md`,
    `# Transcript — ${params.meetingSubject}\n\n\`\`\`\n${transcriptText}\n\`\`\`\n`,
    `Add transcript for ${params.meetingSubject} (${dateStr})`
  );

  await upsertFile(
    `${folderPath}/summary.md`,
    renderSummaryMarkdown(params.meetingDateIso, params.summary),
    `Add summary for ${params.meetingSubject} (${dateStr})`
  );

  await upsertFile(
    `${folderPath}/action-items.md`,
    renderActionItemsMarkdown(params.summary),
    `Add action items for ${params.meetingSubject} (${dateStr})`
  );

  if (config.github.createIssuesForActionItems && params.summary.action_items.length) {
    await createIssuesForActionItems(params.summary, folderPath);
  }

  return { folderPath };
}
