// Renders the meeting details page for links like /meeting/<meeting_id>/<hash>. The
// meeting comes from the API (api/src/functions/meetings.js), which checks the hash.
// Action item statuses are saved through the API as soon as they change, and Follow up asks
// the API to email the task's owner; filters and transcript search happen in the browser only.
(() => {
  const STATUSES = [
    { id: "open", label: "Open" },
    { id: "in_progress", label: "In progress" },
    { id: "qa", label: "QA" },
    { id: "blocked", label: "Blocked" },
    { id: "done", label: "Done" },
  ];
  const LINK = /^\/meeting\/([A-Za-z0-9]+)\/([0-9A-Fa-f]{64})\/?$/;

  let meeting;
  let meetingLink; // { id, hash } from the page address
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

    // The first five speakers are shown; the rest are listed under a "+N" button.
    const shown = speakers.slice(0, 5).map(avatar);
    if (speakers.length > 5) shown.push(moreSpeakers(speakers.slice(5)));
    $("speakers-item").hidden = !speakers.length;
    $("speaker-avatars").replaceChildren(...shown);
    $("speaker-count").textContent = `${speakers.length} ${speakers.length === 1 ? "speaker" : "speakers"}`;
  }

  function moreSpeakers(names) {
    const button = el("button", "avatar avatar-more", `+${names.length}`);
    button.type = "button";
    button.setAttribute("aria-label", `Show ${names.length} more speakers`);
    button.setAttribute("aria-expanded", "false");
    button.setAttribute("aria-controls", "more-speakers");

    const list = el("ul", "people", ...names.map((name) => el("li", "person", avatar(name), el("span", "", name))));
    const menu = el("div", "menu menu-left people-menu", list);
    menu.id = "more-speakers";
    menu.hidden = true;
    menu.tabIndex = -1; // so Escape works once the list has focus
    setUpMenu(button, menu);
    return el("span", "menu-wrap avatar-more-wrap", button, menu);
  }

  function renderSummary() {
    const { overview, keyPoints } = meeting.summary;
    $("summary-overview").replaceChildren(...overview.map((text) => el("p", "", text)));
    $("key-points").hidden = !keyPoints.length;
    $("key-points-list").replaceChildren(...keyPoints.map((text) => el("li", "", text)));
  }

  // ---- Action items ----
  // Overdue isn't a status anyone picks: it's worked out from the due date, so it can't be
  // set or cleared by hand. Due dates count only in the form Claude is asked to write them:
  // "Thu 5 Nov", "Before 20 Nov", or "Fri 8 Jan 2027" when the year isn't the meeting's.
  // Anything else ("Thursday", "Before release", "—") is never overdue.
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  const DUE_DATE = /^(before\s+|by\s+)?(?:(?:mon|tue|wed|thu|fri|sat|sun)[a-z]*,?\s+)?(\d{1,2})\s+([a-z]{3})[a-z]*\.?(?:\s+(\d{4}))?$/i;

  function dueDate(due) {
    const match = DUE_DATE.exec(String(due ?? "").trim());
    if (!match) return null;
    const month = MONTHS.indexOf(match[3].toLowerCase());
    if (month < 0) return null;
    const year = match[4] ? Number(match[4]) : new Date(meeting.date ?? Date.now()).getFullYear();
    const date = new Date(year, month, Number(match[2]));
    if (date.getMonth() !== month) return null; // e.g. "31 Nov"
    return { date, before: /^before/i.test(match[1] ?? "") };
  }

  // "Before 20 Nov" is overdue from the 20th; "Thu 5 Nov" from the day after. Uses the viewer's date.
  function isOverdue(item) {
    if (item.status === "done") return false;
    const due = dueDate(item.due);
    if (!due) return false;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return due.before ? today >= due.date : today > due.date;
  }

  // Overdue items first and Done items last; within each group, the order Claude listed them in.
  // Used by the table and the exported PDF. `index` stays the item's position in the meeting,
  // which is what saving uses.
  function inDisplayOrder(items) {
    const rank = (item) => (item.status === "done" ? 2 : isOverdue(item) ? 0 : 1);
    return items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => rank(a.item) - rank(b.item) || a.index - b.index);
  }

  function renderActionItems() {
    const items = meeting.actionItems;
    $("actions-body").hidden = !items.length;
    if (!items.length) {
      $("actions-sub").textContent = "No action items were identified in this meeting.";
      return;
    }

    const count = (status) => items.filter((item) => item.status === status).length;
    const overdue = items.filter(isOverdue).length;
    const done = count("done");
    // Overdue items are also counted under their status (an item can be blocked and overdue).
    const pending = [
      [count("blocked"), "blocked"],
      [overdue, "overdue"],
      [count("in_progress"), "in progress"],
      [count("qa"), "in QA"],
      [count("open"), "not started"],
    ].filter(([n]) => n > 0);
    // The blocked and overdue counts are highlighted pills, and a pill stands in for the "·" after it.
    const PILLS = { blocked: "blocked-count", overdue: "overdue-count" };
    if (pending.length) {
      const parts = pending.flatMap(([n, label], i) => [
        ...(i ? [PILLS[pending[i - 1][1]] ? " " : " · "] : []),
        PILLS[label] ? el("span", PILLS[label], `${n} ${label}`) : `${n} ${label}`,
      ]);
      $("actions-sub").replaceChildren(...parts);
    } else {
      $("actions-sub").textContent = "All action items are done";
    }

    $("progress-label").textContent = `${done} of ${items.length} done`;
    $("progress-fill").style.width = `${(done / items.length) * 100}%`;

    const filters = [
      { id: "all", label: "All", count: items.length },
      ...STATUSES.map((s) => ({ ...s, count: count(s.id) })),
      { id: "overdue", label: "Overdue", count: overdue },
    ];
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

    const rows = inDisplayOrder(items)
      .filter(({ item }) => activeFilter === "all" || (activeFilter === "overdue" ? isOverdue(item) : item.status === activeFilter))
      .map(({ item, index }) => itemRow(item, index));
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
      saveStatus(item, index);
    });

    const note = el("div", item.note?.error ? "save-note save-error" : "save-note", item.note?.text ?? "");
    note.dataset.note = index;
    note.setAttribute("role", "status");

    // Shown, not chosen: the tag goes away when the item is marked Done.
    const statusStack = el("div", "status-stack", el("span", `status s-${item.status}`, select, icon("chevron")));
    if (isOverdue(item)) {
      const tag = el("span", "overdue-tag", "Overdue");
      tag.title = `Due ${item.due}. Set automatically; it clears when the item is marked Done.`;
      statusStack.append(tag);
    }
    statusStack.append(note);

    return el("tr", item.status === "done" ? "row-done" : "",
      el("td", "", el("div", "task-title", item.task)),
      labelledCell("Owner", "", el("div", "owner", avatar(item.owner), item.owner)),
      labelledCell("Due", "due", item.due || "—"),
      labelledCell("Status", "", statusStack),
      labelledCell("Follow-up", "", followUpCell(item, index)),
    );
  }

  // ---- Follow-ups ----
  // The Follow up button asks the API to email the task's owner (through the follow-up Logic
  // App). "Last follow-up" shows only after an email was actually sent, and stays hidden until
  // then. Like status notes, the button's state lives on the item so it survives the table
  // being rebuilt, and the cell is replaced in place so the rest of the table isn't disturbed.
  const NO_OWNER = /^(|—|-|unassigned)$/i;
  const FOLLOW_UP_ERRORS = {
    no_email: "No email found for this owner.",
    no_owner: "This task has no owner.",
    done: "This task is done.",
    item_changed: "This meeting has changed since you opened it. Reload the page.",
    not_found: "This meeting is no longer available.",
  };

  // "Tue 10 Nov, 2:15 PM" in the viewer's time zone, with the year if it isn't this year.
  function formatSentAt(iso) {
    const date = new Date(iso);
    const options = { weekday: "short", day: "numeric", month: "short" };
    if (date.getFullYear() !== new Date().getFullYear()) options.year = "numeric";
    const { time, period } = clockParts(date);
    return `${date.toLocaleDateString("en-GB", options)}, ${time} ${period}`;
  }

  function followUpCell(item, index) {
    const done = item.status === "done";
    const noOwner = NO_OWNER.test(String(item.owner ?? "").trim());
    const label = item.followUpSending ? "Sending…" : item.followUpSent ? "Sent ✓" : "Follow up";
    const button = el("button", item.followUpSent ? "follow-up follow-up-sent" : "follow-up", icon("send"), label);
    button.type = "button";
    button.setAttribute("aria-label", `Follow up on "${item.task}"`);
    button.disabled = done || noOwner || Boolean(item.followUpSending);
    if (done) button.title = "This task is done";
    else if (noOwner) button.title = "This task has no owner";
    button.addEventListener("click", () => sendFollowUp(item, index));

    const cell = el("div", "follow-up-cell", button);
    cell.dataset.followUp = index;
    if (item.followUpError) {
      const error = el("div", "follow-up-error", item.followUpError);
      error.setAttribute("role", "alert");
      cell.append(error);
    }
    if (item.lastFollowUpAt) {
      const last = el("div", "last-follow-up", `Last follow-up: ${formatSentAt(item.lastFollowUpAt)}`);
      last.title = new Date(item.lastFollowUpAt).toLocaleString();
      cell.append(last);
    }
    return cell;
  }

  function refreshFollowUp(item, index, focus = false) {
    const cell = document.querySelector(`#items-body [data-follow-up="${index}"]`);
    if (!cell) return;
    const next = followUpCell(item, index);
    cell.replaceWith(next);
    if (focus) next.querySelector(".follow-up").focus();
  }

  async function sendFollowUp(item, index) {
    if (item.followUpSending) return;
    item.followUpSending = true;
    item.followUpSent = false;
    item.followUpError = null;
    refreshFollowUp(item, index, true);

    let error = null;
    try {
      const response = await fetch(`/api/meetings/${meetingLink.id}/action-items/${index}/follow-up`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Meeting-Link": meetingLink.hash },
        body: JSON.stringify({ task: item.task }),
      });
      const result = await response.json().catch(() => ({}));
      // Only a confirmed send updates "Last follow-up".
      if (response.ok && result.sentAt) item.lastFollowUpAt = result.sentAt;
      else error = FOLLOW_UP_ERRORS[result.error] ?? "Couldn't send the follow-up. Try again.";
    } catch {
      error = "Couldn't send the follow-up. Check your connection and try again.";
    }

    item.followUpSending = false;
    item.followUpError = error;
    item.followUpSent = !error;
    refreshFollowUp(item, index, true);
    if (!error) {
      setTimeout(() => {
        if (!item.followUpSent) return;
        item.followUpSent = false;
        refreshFollowUp(item, index);
      }, 3000);
    }
  }

  // ---- Saving statuses ----
  // The note under a status ("Saving…", "Saved", "Couldn't save…") is kept on the item, so
  // it survives the table being rebuilt, and updated in place so focus isn't disturbed.
  function setNote(item, index, text, error = false) {
    item.note = text ? { text, error } : null;
    const node = document.querySelector(`#items-body [data-note="${index}"]`);
    if (!node) return;
    node.textContent = text;
    node.classList.toggle("save-error", error);
  }

  const SAVE_ERRORS = {
    item_changed: "This meeting has changed since you opened it. Reload the page.",
    not_found: "This meeting is no longer available.",
  };

  // Saves one item's status. Saves for the same item go one at a time, and if the status
  // changes again while one is in flight, the newest choice is saved next, so a slow
  // earlier save can't overwrite a later one.
  async function saveStatus(item, index) {
    if (item.saving) {
      item.saveAgain = true;
      return;
    }
    item.saving = true;
    let failure = null;
    do {
      item.saveAgain = false;
      const wanted = item.status;
      setNote(item, index, "Saving…");
      failure = null;
      try {
        const response = await fetch(`/api/meetings/${meetingLink.id}/action-items/${index}/status`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "X-Meeting-Link": meetingLink.hash },
          body: JSON.stringify({ status: wanted, task: item.task }),
        });
        if (response.ok) {
          item.savedStatus = wanted;
        } else {
          const { error } = await response.json().catch(() => ({}));
          failure = SAVE_ERRORS[error] ?? "Couldn't save. Try again.";
        }
      } catch {
        failure = "Couldn't save. Check your connection and try again.";
      }
    } while (item.saveAgain);
    item.saving = false;

    if (failure) {
      // Put the status back to the last one that was saved.
      item.status = item.savedStatus;
      setNote(item, index, failure, true);
      renderActionItems();
      return;
    }
    setNote(item, index, "Saved");
    setTimeout(() => { if (item.note?.text === "Saved") setNote(item, index, ""); }, 2000);
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

  const fileName = (kind, extension) => `${meeting.title.replace(/[\\/:*?"<>|]/g, "-")} ${kind}.${extension}`;

  function downloadTranscriptText() {
    const text = meeting.transcript.map((line) => `[${line.time}] ${line.speaker}: ${line.text}`).join("\n");
    const url = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    const link = el("a");
    link.href = url;
    link.download = fileName("transcript", "txt");
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // jsPDF is loaded only when someone downloads a PDF. The integrity hash makes the
  // browser refuse the file if it isn't exactly jsPDF 3.0.1 as published.
  let jsPdfLoading;
  function loadJsPdf() {
    jsPdfLoading ??= new Promise((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "https://cdnjs.cloudflare.com/ajax/libs/jspdf/3.0.1/jspdf.umd.min.js";
      script.integrity = "sha384-ytX5osgYad9GPnagB0k+CxKTir/bsE7AfpzvCnQ7owfeWuDd+2l2y0PSIqRK+z/2";
      script.crossOrigin = "anonymous";
      script.onload = () => resolve(window.jspdf.jsPDF);
      script.onerror = () => {
        jsPdfLoading = undefined;
        reject(new Error("jsPDF didn't load"));
      };
      document.head.append(script);
    });
    return jsPdfLoading;
  }

  // Builds an A4 PDF and saves it. `fill` adds the content through write(text, size, bold,
  // gapAfter), space(points) and table(columns, rows); the meeting's title and date always come first.
  async function savePdf(name, fill) {
    let jsPDF;
    try {
      jsPDF = await loadJsPdf();
    } catch {
      alert("The PDF couldn't be created. Check your connection and try again.");
      return;
    }

    // 48pt margins; text wraps to the page width and flows onto new pages.
    const doc = new jsPDF({ unit: "pt", format: "a4" });
    const margin = 48;
    const width = doc.internal.pageSize.getWidth() - margin * 2;
    const bottom = doc.internal.pageSize.getHeight() - margin;
    let y = margin;
    const write = (text, size, bold, gapAfter) => {
      doc.setFont("helvetica", bold ? "bold" : "normal");
      doc.setFontSize(size);
      for (const line of doc.splitTextToSize(text, width)) {
        if (y + size * 1.35 > bottom) {
          doc.addPage();
          y = margin;
        }
        doc.text(line, margin, y, { baseline: "top" });
        y += size * 1.35;
      }
      y += gapAfter;
    };

    // Space between sections; the next write starts a new page if it doesn't fit.
    const space = (points) => { y += points; };

    // A table whose cells wrap; the header row repeats at the top of each new page.
    // columns: [{ header, share }] with shares adding up to 1. rows: [{ cells, color }], where a
    // cell is text or { text, color } and colours are [r, g, b].
    const table = (columns, rows) => {
      const size = 9.5, lineFactor = 1.3, pad = 5;
      const widths = columns.map((c) => c.share * width);
      const layout = (cells, bold) => {
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setFontSize(size);
        const lines = cells.map((cell, i) => doc.splitTextToSize(String(cell?.text ?? cell), widths[i] - pad * 2));
        return { lines, height: Math.max(...lines.map((l) => l.length)) * size * lineFactor + pad * 2 };
      };
      const draw = (cells, { lines, height }, { bold = false, background = null, color = [17, 24, 39] } = {}) => {
        if (background) {
          doc.setFillColor(...background);
          doc.rect(margin, y, width, height, "F");
        }
        doc.setFont("helvetica", bold ? "bold" : "normal");
        doc.setFontSize(size);
        let x = margin;
        lines.forEach((cellLines, i) => {
          doc.setTextColor(...(cells[i]?.color ?? color));
          doc.text(cellLines, x + pad, y + pad, { baseline: "top", lineHeightFactor: lineFactor });
          x += widths[i];
        });
        doc.setTextColor(0, 0, 0);
        doc.setDrawColor(209, 213, 219);
        doc.line(margin, y + height, margin + width, y + height);
        y += height;
      };

      const headerCells = columns.map((c) => c.header);
      const header = layout(headerCells, true);
      const drawHeader = () => draw(headerCells, header, { bold: true, background: [243, 244, 246] });
      // Don't leave the header alone at the bottom of a page.
      if (rows.length && y + header.height + layout(rows[0].cells).height > bottom) {
        doc.addPage();
        y = margin;
      }
      drawHeader();
      for (const row of rows) {
        const box = layout(row.cells);
        if (y + box.height > bottom) {
          doc.addPage();
          y = margin;
          drawHeader();
        }
        draw(row.cells, box, { color: row.color });
      }
    };

    write(meeting.title, 16, true, 2);
    if (meeting.date) write($("meeting-when").textContent, 10, false, 14);
    fill(write, space, table);
    doc.save(name);
  }

  // Each line as "[time] Speaker" in bold, then what they said.
  function writeTranscript(write) {
    for (const line of meeting.transcript) {
      write(`[${line.time}] ${line.speaker}`, 10, true, 0);
      write(line.text, 10, false, 10);
    }
  }

  function downloadTranscriptPdf() {
    savePdf(fileName("transcript", "pdf"), writeTranscript);
  }

  // Export: the whole meeting record (summary, key points, action items with their
  // current status, the transcript, then the participants).
  function exportMeetingPdf() {
    savePdf(fileName("summary", "pdf"), (write, space, table) => {
      const { overview, keyPoints } = meeting.summary;
      write("Summary", 13, true, 6);
      overview.forEach((paragraph) => write(paragraph, 10, false, 8));
      if (keyPoints.length) {
        write("Key points", 11, true, 4);
        keyPoints.forEach((point) => write(`•  ${point}`, 10, false, 3));
      }

      space(14);
      write("Action items", 13, true, 6);
      if (!meeting.actionItems.length) write("No action items were identified in this meeting.", 10, false, 0);
      else {
        // Same order and colours as the page: overdue first in orange, done last in grey.
        table(
          [
            { header: "Task", share: 0.4 },
            { header: "Owner", share: 0.2 },
            { header: "Due", share: 0.15 },
            { header: "Status", share: 0.25 },
          ],
          inDisplayOrder(meeting.actionItems).map(({ item }) => {
            const status = STATUSES.find((s) => s.id === item.status).label;
            return {
              color: item.status === "done" ? [107, 114, 128] : undefined,
              cells: [
                item.task,
                item.owner,
                item.due || "—",
                isOverdue(item) ? { text: `${status} (Overdue)`, color: [180, 84, 10] } : status,
              ],
            };
          }),
        );
      }

      space(14);
      write("Transcript", 13, true, 6);
      if (!meeting.transcript.length) write("No transcript is available for this meeting.", 10, false, 0);
      writeTranscript(write);

      space(14);
      write("Participants", 13, true, 6);
      if (!meeting.participants.length) write("No participants were recorded for this meeting.", 10, false, 0);
      meeting.participants.forEach((participant) => write(`•  ${participant}`, 10, false, 3));
    });
  }

  // ---- Menus (settings, transcript download, more speakers) ----
  const closeMenus = [];

  function setUpMenu(button, menu) {
    const close = () => {
      menu.hidden = true;
      button.setAttribute("aria-expanded", "false");
    };
    closeMenus.push(close);
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      const opening = menu.hidden;
      closeMenus.forEach((c) => c());
      if (opening) {
        menu.hidden = false;
        button.setAttribute("aria-expanded", "true");
        // The speakers list has no items to choose, so the list itself takes focus.
        (menu.querySelector(".menu-item") ?? menu).focus();
      }
    });
    // Choosing an item closes the menu.
    menu.addEventListener("click", close);
    menu.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        close();
        button.focus();
      }
    });
  }

  setUpMenu($("settings-button"), $("settings-menu"));
  setUpMenu($("download-button"), $("download-menu"));
  document.addEventListener("click", () => closeMenus.forEach((c) => c()));
  // "Connect GitHub" doesn't do anything yet.

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
    meetingLink = { id: link[1], hash: link[2] };
    meeting.actionItems.forEach((item) => {
      // The API sends each item's saved status (open if nobody has changed it).
      if (!STATUSES.some((s) => s.id === item.status)) item.status = "open";
      item.savedStatus = item.status;
    });
    speakers = [...new Set(meeting.transcript.map((line) => line.speaker))];

    renderHeader();
    renderSummary();
    renderActionItems();
    renderTranscript();
    $("transcript-search").addEventListener("input", (event) => renderTranscript(event.target.value));
    $("download-text").addEventListener("click", downloadTranscriptText);
    $("download-pdf").addEventListener("click", downloadTranscriptPdf);
    $("export-button").addEventListener("click", exportMeetingPdf);
    $("notice").hidden = true;
    $("page").hidden = false;
  }

  load();
})();
