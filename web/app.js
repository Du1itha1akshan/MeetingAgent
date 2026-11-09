// Renders the meeting details page for links like /meeting/<meeting_id>/<hash>. The
// meeting comes from the API (api/src/functions/meetings.js), which checks the hash.
// Action item statuses are saved through the API as soon as they change; filters and
// transcript search happen in the browser only.
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
  // Done items last; otherwise the order Claude listed them in. Used by the table and the
  // exported PDF. `index` stays the item's position in the meeting, which is what saving uses.
  function inDisplayOrder(items) {
    return items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => (a.item.status === "done") - (b.item.status === "done") || a.index - b.index);
  }

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
      [count("qa"), "in QA"],
      [count("open"), "not started"],
    ].filter(([n]) => n > 0);
    if (pending.length) {
      // The blocked count is highlighted in red, and the pill stands in for the "·" after it.
      const parts = pending.flatMap(([n, label], i) => [
        ...(i ? [pending[i - 1][1] === "blocked" ? " " : " · "] : []),
        label === "blocked" ? el("span", "blocked-count", `${n} blocked`) : `${n} ${label}`,
      ]);
      $("actions-sub").replaceChildren(...parts);
    } else {
      $("actions-sub").textContent = "All action items are done";
    }

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

    const rows = inDisplayOrder(items)
      .filter(({ item }) => activeFilter === "all" || item.status === activeFilter)
      .map(({ item, index }) => itemRow(item, index));
    if (!rows.length) {
      const cell = el("td", "no-items", "No action items with this status.");
      cell.colSpan = 6;
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

    // Doesn't send anything yet. Done tasks don't need a follow-up, so the button is disabled.
    const followUp = el("button", "follow-up", icon("send"), "Follow up");
    followUp.type = "button";
    followUp.setAttribute("aria-label", `Follow up on "${item.task}"`);
    followUp.disabled = item.status === "done";
    if (followUp.disabled) followUp.title = "This task is done";

    const createIssue = el("button", "tracker", icon("plus"), "Create issue");
    createIssue.type = "button";

    const note = el("div", item.note?.error ? "save-note save-error" : "save-note", item.note?.text ?? "");
    note.dataset.note = index;
    note.setAttribute("role", "status");

    return el("tr", item.status === "done" ? "row-done" : "",
      el("td", "", el("div", "task-title", item.task)),
      labelledCell("Owner", "", el("div", "owner", avatar(item.owner), item.owner)),
      labelledCell("Due", "due", item.due || "—"),
      labelledCell("Status", "", el("span", `status s-${item.status}`, select, icon("chevron")), note),
      labelledCell("Follow-up", "", followUp),
      labelledCell("Tracker", "", createIssue),
    );
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

  // Builds an A4 PDF and saves it. `fill` adds the content through
  // write(text, size, bold, gapAfter) and space(points); the meeting's title and date always come first.
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

    write(meeting.title, 16, true, 2);
    if (meeting.date) write($("meeting-when").textContent, 10, false, 14);
    fill(write, space);
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
    savePdf(fileName("summary", "pdf"), (write, space) => {
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
      for (const { item } of inDisplayOrder(meeting.actionItems)) {
        const status = STATUSES.find((s) => s.id === item.status).label;
        write(item.task, 10, true, 0);
        write(`Owner: ${item.owner}     Due: ${item.due || "—"}     Status: ${status}`, 10, false, 8);
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
