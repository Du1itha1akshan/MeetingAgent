// Renders the meeting details page for links like /meeting/<meeting_id>/<hash>. The
// meeting comes from the API (api/src/functions/meetings.js), which checks the hash.
// Status changes, filters and transcript search happen in the browser only; nothing is saved yet.
(() => {
  const STATUSES = [
    { id: "open", label: "Open" },
    { id: "in_progress", label: "In progress" },
    { id: "blocked", label: "Blocked" },
    { id: "done", label: "Done" },
  ];
  const LINK = /^\/meeting\/([A-Za-z0-9]+)\/([0-9A-Fa-f]{64})\/?$/;

  let meeting;
  let speakers = [];
  let activeFilter = "all";

  // ---- DOM helpers: data always goes in as text, never as HTML ----
  const $ = (id) => document.getElementById(id);

  function el(tag, className, ...children) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    node.append(...children);
    return node;
  }

  function icon(name) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "icon");
    svg.setAttribute("aria-hidden", "true");
    const use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    use.setAttribute("href", `#i-${name}`);
    svg.append(use);
    return svg;
  }

  const initials = (name) => name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase();

  function avatar(name) {
    // Each speaker keeps the same colour everywhere on the page; anyone else is grey.
    const index = speakers.indexOf(name);
    const node = el("span", `avatar ${index < 0 ? "tone-none" : `tone-${index % 5}`}`, initials(name));
    node.title = name;
    return node;
  }

  // ---- Formatting ----
  const clockFormat = new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit" });

  function clockParts(date) {
    const parts = Object.fromEntries(clockFormat.formatToParts(date).map((part) => [part.type, part.value]));
    return { time: `${parts.hour}:${parts.minute}`, period: parts.dayPeriod };
  }

  // "Thu, 6 Nov 2026 · 10:04–10:11 AM" in the viewer's time zone; just the start without a length.
  function formatWhen(start, minutes) {
    const weekday = start.toLocaleDateString("en-GB", { weekday: "short" });
    const date = start.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
    const from = clockParts(start);
    if (!minutes) return `${weekday}, ${date} · ${from.time} ${from.period}`;
    const to = clockParts(new Date(start.getTime() + minutes * 60000));
    const range = from.period === to.period
      ? `${from.time}–${to.time} ${to.period}`
      : `${from.time} ${from.period}–${to.time} ${to.period}`;
    return `${weekday}, ${date} · ${range}`;
  }

  // Length of the meeting from the time of the transcript's last line ("mm:ss" or "h:mm:ss").
  function transcriptMinutes() {
    const last = meeting.transcript[meeting.transcript.length - 1];
    if (!last) return 0;
    const seconds = last.time.split(":").reduce((total, part) => total * 60 + Number(part), 0);
    return Math.max(1, Math.ceil(seconds / 60));
  }

  // ---- Header and summary ----
  function renderHeader() {
    document.title = `${meeting.title} · Meeting Assistant`;
    $("crumb-current").textContent = meeting.title;
    $("breadcrumb").hidden = false;
    $("meeting-title").textContent = meeting.title;

    const minutes = transcriptMinutes();
    $("when-item").hidden = !meeting.date;
    if (meeting.date) $("meeting-when").textContent = formatWhen(new Date(meeting.date), minutes);
    $("duration-item").hidden = !minutes;
    $("meeting-duration").textContent = `${minutes} min`;

    $("speakers-item").hidden = !speakers.length;
    $("speaker-avatars").replaceChildren(...speakers.map(avatar));
    $("speaker-count").textContent = `${speakers.length} ${speakers.length === 1 ? "speaker" : "speakers"}`;
  }

  function renderSummary() {
    const { overview, keyPoints } = meeting.summary;
    $("summary-overview").replaceChildren(...overview.map((text) => el("p", "", text)));
    $("key-points").hidden = !keyPoints.length;
    $("key-points-list").replaceChildren(...keyPoints.map((text) => el("li", "", text)));
  }

  // ---- Action items ----
  function renderActionItems() {
    const items = meeting.actionItems;
    $("actions-body").hidden = !items.length;
    if (!items.length) {
      $("actions-sub").textContent = "No action items were identified in this meeting.";
      return;
    }

    const count = (status) => items.filter((item) => item.status === status).length;
    const done = count("done");
    const pending = [
      [count("blocked"), "blocked"],
      [count("in_progress"), "in progress"],
      [count("open"), "not started"],
    ].filter(([n]) => n > 0).map(([n, label]) => `${n} ${label}`);
    $("actions-sub").textContent = pending.length
      ? `${pending.join(" · ")} — these go into the follow-up email`
      : "All action items are done";

    $("progress-label").textContent = `${done} of ${items.length} done`;
    $("progress-fill").style.width = `${(done / items.length) * 100}%`;

    const filters = [{ id: "all", label: "All", count: items.length }, ...STATUSES.map((s) => ({ ...s, count: count(s.id) }))];
    $("filters").replaceChildren(...filters.map((filter) => {
      const dot = el("span", filter.id === "all" ? "dot" : `dot s-${filter.id}`);
      const button = el("button", "filter", dot, filter.label, el("span", "", String(filter.count)));
      button.type = "button";
      button.setAttribute("aria-pressed", String(filter.id === activeFilter));
      button.addEventListener("click", () => {
        activeFilter = filter.id;
        renderActionItems();
      });
      return button;
    }));

    const rows = items
      .filter((item) => activeFilter === "all" || item.status === activeFilter)
      .map((item) => itemRow(item, items.indexOf(item)));
    if (!rows.length) {
      const cell = el("td", "no-items", "No action items with this status.");
      cell.colSpan = 5;
      rows.push(el("tr", "", cell));
    }
    $("items-body").replaceChildren(...rows);
  }

  function itemRow(item, index) {
    const select = el("select");
    select.dataset.index = index;
    select.setAttribute("aria-label", `Status of "${item.task}"`);
    for (const status of STATUSES) {
      const option = el("option", "", status.label);
      option.value = status.id;
      option.selected = status.id === item.status;
      select.append(option);
    }
    select.addEventListener("change", () => {
      item.status = select.value;
      renderActionItems();
      // The table is rebuilt, so put focus back on this item's status.
      document.querySelector(`#items-body select[data-index="${index}"]`)?.focus();
    });

    const createIssue = el("button", "tracker", icon("plus"), "Create issue");
    createIssue.type = "button";

    return el("tr", item.status === "done" ? "row-done" : "",
      el("td", "", el("div", "task-title", item.task)),
      labelledCell("Owner", "", el("div", "owner", avatar(item.owner), item.owner)),
      labelledCell("Due", "due", item.due || "—"),
      labelledCell("Status", "", el("span", `status s-${item.status}`, select, icon("chevron"))),
      labelledCell("Tracker", "", createIssue),
    );
  }

  // On narrow screens the table header is hidden and each cell shows this label instead.
  function labelledCell(label, className, ...children) {
    const cell = el("td", className, ...children);
    cell.dataset.label = label;
    return cell;
  }

  // ---- Transcript ----
  function renderTranscript(query = "") {
    const needle = query.trim().toLowerCase();
    const lines = meeting.transcript.filter((line) =>
      !needle || line.text.toLowerCase().includes(needle) || line.speaker.toLowerCase().includes(needle));

    const items = lines.map((line) => el("li", "line",
      avatar(line.speaker),
      el("div", "",
        el("div", "line-head", el("span", "speaker", line.speaker), el("span", "time", line.time)),
        el("p", "", ...highlight(line.text, needle)))));
    if (!items.length) {
      items.push(el("li", "no-lines", meeting.transcript.length ? "No lines match your search." : "This meeting has no transcript."));
    }
    $("transcript-list").replaceChildren(...items);
  }

  // Splits text into plain parts and <mark> parts, one for each match of needle.
  function highlight(text, needle) {
    if (!needle) return [text];
    const lower = text.toLowerCase();
    const parts = [];
    let from = 0;
    for (let at = lower.indexOf(needle); at !== -1; at = lower.indexOf(needle, from)) {
      parts.push(text.slice(from, at), el("mark", "", text.slice(at, at + needle.length)));
      from = at + needle.length;
    }
    parts.push(text.slice(from));
    return parts;
  }

  function downloadTranscript() {
    const text = meeting.transcript.map((line) => `[${line.time}] ${line.speaker}: ${line.text}`).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = el("a");
    link.href = url;
    link.download = `${meeting.title.replace(/[\\/:*?"<>|]/g, "-")} transcript.txt`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- Loading ----
  async function load() {
    const link = location.pathname.match(LINK);
    if (!link) {
      $("notice").textContent = "This link is incomplete. Open the meeting from the View Details button in its summary email.";
      return;
    }

    let response;
    try {
      // The hash goes in a header rather than the address, so it isn't written to request logs.
      response = await fetch(`/api/meetings/${link[1]}`, { headers: { "X-Meeting-Link": link[2] } });
    } catch {
      $("notice").textContent = "The meeting couldn't be loaded. Check your connection and try again.";
      return;
    }
    if (response.status === 404) {
      $("notice").textContent = "This meeting link isn't valid, or the meeting is no longer available.";
      return;
    }
    if (!response.ok) {
      $("notice").textContent = "The meeting couldn't be loaded. Try again in a minute.";
      return;
    }

    meeting = await response.json();
    meeting.actionItems.forEach((item) => { item.status = "open"; });
    speakers = [...new Set(meeting.transcript.map((line) => line.speaker))];

    renderHeader();
    renderSummary();
    renderActionItems();
    renderTranscript();
    $("transcript-search").addEventListener("input", (event) => renderTranscript(event.target.value));
    $("transcript-download").addEventListener("click", downloadTranscript);
    $("notice").hidden = true;
    $("page").hidden = false;
  }

  load();
})();
