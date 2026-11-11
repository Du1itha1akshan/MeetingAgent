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
  let sort = { by: null, dir: "asc" }; // by: null (default order), "owner" or "due"
  let searchText = "";  // the action item search, lower-cased
  let ownerFilter = ""; // an owner's name, "__none__" for no owner, or "" for everyone
  // null (any date), { preset } (overdue, today, this-week, next-week, later, no-date) or
  // { from, to }: days picked on the calendar (local midnight; the same day for a single day).
  let dueFilter = null;

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

  // How many days late an item is, or 0. "Thu 5 Nov" is due by the end of the 5th, so it's
  // 1 day overdue on the 6th; "Before 20 Nov" is due by the end of the 19th, so 1 day on the 20th.
  // Uses the viewer's date.
  function overdueDays(item) {
    if (item.status === "done") return 0;
    const due = dueDate(item.due);
    if (!due) return 0;
    const lastDay = new Date(due.date);
    if (due.before) lastDay.setDate(lastDay.getDate() - 1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((today - lastDay) / 86400000));
  }

  const isOverdue = (item) => overdueDays(item) > 0;
  const overdueText = (item) => {
    const days = overdueDays(item);
    return `Overdue · ${days} ${days === 1 ? "day" : "days"}`;
  };

  // ---- Search and owner / due date filters ----
  // They combine with each other and with the status filters. Due dates use the last day allowed
  // ("Before 20 Nov" counts as the 19th) and the viewer's date; weeks run Monday to Sunday, as in
  // the prompt that writes the due dates. "No set date" is "—" or a phrase such as "Before release".
  const ownerKey = (item) => {
    const owner = String(item.owner ?? "").trim();
    return NO_OWNER.test(owner) ? "__none__" : owner;
  };

  const startOfDay = (date) => { const d = new Date(date); d.setHours(0, 0, 0, 0); return d; };
  const addDays = (date, n) => { const d = new Date(date); d.setDate(d.getDate() + n); return d; };
  const sameDay = (a, b) => Boolean(a && b) && a.getTime() === b.getTime();

  // The last day an item may be finished: its due date, or the day before for "Before …".
  function lastDueDay(item) {
    const due = dueDate(item.due);
    if (!due) return null;
    return due.before ? addDays(due.date, -1) : startOfDay(due.date);
  }

  function dueMatches(item, filter) {
    if (!filter) return true;
    const last = lastDueDay(item);
    if (filter.from) return Boolean(last) && last >= filter.from && last <= filter.to;
    if (filter.preset === "no-date") return !last;
    if (filter.preset === "overdue") return isOverdue(item);
    if (!last) return false;
    const today = startOfDay(new Date());
    const monday = addDays(today, -((today.getDay() + 6) % 7));
    const nextMonday = addDays(monday, 7);
    const mondayAfter = addDays(monday, 14);
    if (filter.preset === "today") return sameDay(last, today);
    if (filter.preset === "this-week") return last >= monday && last < nextMonday;
    if (filter.preset === "next-week") return last >= nextMonday && last < mondayAfter;
    if (filter.preset === "later") return last >= mondayAfter;
    return true;
  }

  const matchesOwnerAndSearch = (item) =>
    (!ownerFilter || ownerKey(item) === ownerFilter)
    && (!searchText || [item.task, item.owner, item.due].some((value) => String(value ?? "").toLowerCase().includes(searchText)));

  const matchesTools = (item) => matchesOwnerAndSearch(item) && dueMatches(item, dueFilter);

  const toolsActive = () => Boolean(searchText || ownerFilter || dueFilter);

  // Every owner A–Z with how many tasks they have, and "Unassigned" last. Rebuilt after an owner
  // is changed; if the chosen owner no longer has any tasks, the filter goes back to everyone.
  function fillOwnerFilter() {
    const counts = new Map();
    for (const item of meeting.actionItems) counts.set(ownerKey(item), (counts.get(ownerKey(item)) ?? 0) + 1);
    const names = [...counts.keys()].filter((key) => key !== "__none__")
      .sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
    const options = names.map((name) => {
      const option = el("option", "", `${name} (${counts.get(name)})`);
      option.value = name;
      return option;
    });
    if (counts.has("__none__")) {
      const option = el("option", "", `Unassigned (${counts.get("__none__")})`);
      option.value = "__none__";
      options.push(option);
    }
    const all = el("option", "", "All owners");
    all.value = "";
    $("owner-filter").replaceChildren(all, ...options);
    if (ownerFilter && !counts.has(ownerFilter)) ownerFilter = "";
    $("owner-filter").value = ownerFilter;
  }

  function clearFilters() {
    searchText = ownerFilter = "";
    dueFilter = null;
    rangeStart = null;
    activeFilter = "all";
    $("item-search").value = $("owner-filter").value = "";
    renderActionItems();
    $("item-search").focus();
  }

  // ---- Due date calendar ----
  // A month calendar under the due date button. Days with tasks due get a dot (orange if any
  // are overdue), counting only items that pass the owner filter and search. Click a day to
  // show what's due that day, then optionally a second day for a range.
  const PRESETS = [
    ["overdue", "Overdue"], ["today", "Today"], ["this-week", "This week"],
    ["next-week", "Next week"], ["later", "Later"], ["no-date", "No set date"],
  ];
  const PRESET_LABELS = { overdue: "Overdue", today: "Due today", "this-week": "Due this week", "next-week": "Due next week", later: "Due later", "no-date": "No set date" };
  let calendarMonth = null; // first day of the month shown
  let calendarFocus = null; // the day that has keyboard focus
  let rangeStart = null;    // first day of a range, waiting for the second click
  const shortDay = (date) => date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  const longDay = (date) => date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });

  function dueLabel() {
    if (!dueFilter) return "Any due date";
    if (dueFilter.preset) return PRESET_LABELS[dueFilter.preset];
    return sameDay(dueFilter.from, dueFilter.to) ? `Due ${shortDay(dueFilter.from)}` : `Due ${shortDay(dueFilter.from)} – ${shortDay(dueFilter.to)}`;
  }

  function openCalendar(open) {
    const calendar = $("due-calendar");
    if (open) {
      closeMenus.forEach((close) => close());
      const start = dueFilter?.from ?? startOfDay(new Date());
      calendarMonth = new Date(start.getFullYear(), start.getMonth(), 1);
      calendarFocus = start;
      rangeStart = null;
      calendar.hidden = false;
      renderCalendar(true);
    } else {
      calendar.hidden = true;
      rangeStart = null;
    }
    $("due-button").setAttribute("aria-expanded", String(open));
  }

  function setDueFilter(filter, close) {
    dueFilter = filter;
    renderActionItems();
    if (close) {
      openCalendar(false);
      $("due-button").focus();
    } else {
      renderCalendar(true);
    }
  }

  function renderCalendar(focus = false) {
    // How many tasks are due on each day (and whether any are overdue).
    const counts = new Map();
    for (const item of meeting.actionItems.filter(matchesOwnerAndSearch)) {
      const last = lastDueDay(item);
      if (!last) continue;
      const entry = counts.get(last.getTime()) ?? { total: 0, overdue: false };
      entry.total++;
      entry.overdue ||= isOverdue(item);
      counts.set(last.getTime(), entry);
    }

    const today = startOfDay(new Date());
    const prev = el("button", "cal-nav cal-prev", icon("chevron"));
    prev.type = "button";
    prev.setAttribute("aria-label", "Previous month");
    prev.addEventListener("click", () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1, 1); calendarFocus = calendarMonth; renderCalendar(); $("due-calendar").querySelector(".cal-prev").focus(); });
    const next = el("button", "cal-nav cal-next", icon("chevron"));
    next.type = "button";
    next.setAttribute("aria-label", "Next month");
    next.addEventListener("click", () => { calendarMonth = new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1, 1); calendarFocus = calendarMonth; renderCalendar(); $("due-calendar").querySelector(".cal-next").focus(); });
    const title = el("div", "cal-title", calendarMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" }));
    title.setAttribute("aria-live", "polite");

    const grid = el("div", "cal-grid");
    grid.setAttribute("role", "grid");
    for (const name of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) grid.append(el("div", "cal-weekday", name));
    const first = addDays(calendarMonth, -((calendarMonth.getDay() + 6) % 7)); // the Monday on or before the 1st
    const range = dueFilter?.from ? dueFilter : null;
    for (let i = 0; i < 42; i++) {
      const day = addDays(first, i);
      const entry = counts.get(day.getTime());
      const classes = ["cal-day"];
      if (day.getMonth() !== calendarMonth.getMonth()) classes.push("other-month");
      if (sameDay(day, today)) classes.push("today");
      if (entry) classes.push(entry.overdue ? "has-overdue" : "has-items");
      const selected = range && day >= range.from && day <= range.to;
      if (selected) classes.push("in-range");
      if (range && sameDay(day, range.from)) classes.push("range-start");
      if (range && sameDay(day, range.to)) classes.push("range-end");
      const button = el("button", classes.join(" "), String(day.getDate()));
      button.type = "button";
      button.dataset.date = day.getTime();
      button.tabIndex = sameDay(day, calendarFocus) ? 0 : -1;
      button.setAttribute("aria-pressed", String(Boolean(selected)));
      const tasks = entry ? `, ${entry.total} ${entry.total === 1 ? "task" : "tasks"} due${entry.overdue ? ", some overdue" : ""}` : "";
      button.setAttribute("aria-label", `${longDay(day)}${tasks}`);
      button.addEventListener("click", () => pickDay(day));
      grid.append(button);
    }
    grid.addEventListener("keydown", (event) => {
      const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (!(event.key in moves)) return;
      event.preventDefault();
      calendarFocus = addDays(calendarFocus, moves[event.key]);
      if (calendarFocus.getMonth() !== calendarMonth.getMonth() || calendarFocus.getFullYear() !== calendarMonth.getFullYear()) {
        calendarMonth = new Date(calendarFocus.getFullYear(), calendarFocus.getMonth(), 1);
      }
      renderCalendar(true);
    });

    const hint = el("p", "cal-hint", rangeStart
      ? `From ${shortDay(rangeStart)}. Click an end date for a range, or close to keep this day.`
      : "Click a day, or two days for a range.");
    const legend = el("p", "cal-legend", el("span", "cal-dot"), "Tasks due", el("span", "cal-dot cal-dot-overdue"), "Overdue");

    const presets = el("div", "cal-presets", ...PRESETS.map(([value, label]) => {
      const button = el("button", "cal-preset", label);
      button.type = "button";
      button.setAttribute("aria-pressed", String(dueFilter?.preset === value));
      button.addEventListener("click", () => { rangeStart = null; setDueFilter({ preset: value }, true); });
      return button;
    }));
    const clear = el("button", "cal-clear", "Clear");
    clear.type = "button";
    clear.addEventListener("click", () => { rangeStart = null; setDueFilter(null, true); });
    presets.append(clear);

    $("due-calendar").replaceChildren(el("div", "cal-head", prev, title, next), grid, hint, legend, presets);
    if (focus) $("due-calendar").querySelector(`.cal-day[data-date="${calendarFocus.getTime()}"]`)?.focus();
  }

  // First click: that day only (the calendar stays open). Second click: the range between them.
  function pickDay(day) {
    calendarFocus = day;
    if (!rangeStart) {
      rangeStart = day;
      setDueFilter({ from: day, to: day }, false);
    } else {
      const [from, to] = day < rangeStart ? [day, rangeStart] : [rangeStart, day];
      rangeStart = null;
      setDueFilter({ from, to }, true);
    }
  }

  function setUpCalendar() {
    const button = $("due-button"), calendar = $("due-calendar");
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      openCalendar(calendar.hidden);
    });
    // Clicks inside the calendar don't close it; clicks anywhere else do (like the other menus).
    calendar.addEventListener("click", (event) => event.stopPropagation());
    calendar.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        openCalendar(false);
        button.focus();
      }
    });
    closeMenus.push(() => { if (!calendar.hidden) openCalendar(false); });
  }

  // ---- Sorting ----
  // Owner: by name, A–Z or Z–A. Due: dates in date order ("Before 20 Nov" counts as the 19th, so
  // it comes just before a plain "20 Nov"), then due dates that are phrases ("Before release"),
  // A–Z. Items with no owner or no due date go last in either direction.
  function sortKey(item, by) {
    if (by === "owner") {
      const owner = String(item.owner ?? "").trim();
      return NO_OWNER.test(owner) ? { empty: true } : { group: 0, value: owner.toLowerCase() };
    }
    const due = String(item.due ?? "").trim();
    if (!due || due === "—" || due === "-") return { empty: true };
    const date = dueDate(due);
    if (date) return { group: 0, value: date.date.getTime() - (date.before ? 1 : 0) };
    return { group: 1, value: due.toLowerCase() };
  }

  function compareBy(a, b, by, dir) {
    const ka = sortKey(a, by), kb = sortKey(b, by);
    if (ka.empty || kb.empty) return (ka.empty ? 1 : 0) - (kb.empty ? 1 : 0);
    if (ka.group !== kb.group) return ka.group - kb.group;
    const order = typeof ka.value === "number" ? ka.value - kb.value : ka.value.localeCompare(kb.value);
    return dir === "desc" ? -order : order;
  }

  // The order used by the table and the exported PDF. Done items always go last. Without a sort
  // chosen, overdue items come first; otherwise the chosen sort decides. Ties keep the order
  // Claude listed them in. `index` stays the item's position in the meeting, which saving uses.
  function inDisplayOrder(items) {
    const done = (item) => (item.status === "done" ? 1 : 0);
    const rank = (item) => (isOverdue(item) ? 0 : 1);
    return items
      .map((item, index) => ({ item, index }))
      .sort((a, b) => done(a.item) - done(b.item)
        || (sort.by ? compareBy(a.item, b.item, sort.by, sort.dir) : rank(a.item) - rank(b.item))
        || a.index - b.index);
  }

  // Clicking Owner or Due sorts ascending, then descending, then back to the default order.
  function setSort(by, dir) {
    sort = { by, dir };
    for (const button of document.querySelectorAll(".sort-btn")) {
      const active = button.dataset.sort === sort.by;
      button.closest("th").setAttribute("aria-sort", active ? (sort.dir === "asc" ? "ascending" : "descending") : "none");
      button.querySelector("use").setAttribute("href", active ? `#i-sort-${sort.dir}` : "#i-sort");
    }
    $("sort-select").value = sort.by ? `${sort.by}:${sort.dir}` : "";
    if (meeting) renderActionItems();
  }

  for (const button of document.querySelectorAll(".sort-btn")) {
    button.addEventListener("click", () => {
      const by = button.dataset.sort;
      if (sort.by !== by) setSort(by, "asc");
      else if (sort.dir === "asc") setSort(by, "desc");
      else setSort(null, "asc");
    });
  }
  $("sort-select").addEventListener("change", (event) => {
    const [by, dir] = event.target.value.split(":");
    setSort(by || null, dir || "asc");
  });

  function renderActionItems() {
    // The table is about to be rebuilt, so close a dropdown list that's open inside it.
    if (document.querySelector("#items-body .dd-list:not([hidden])")) openDropdown?.();
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

    // The status filters count only items that pass the search, owner and due date filters,
    // so they show what each status filter would give. The line above and the progress bar
    // always describe the whole meeting.
    const visible = items.filter(matchesTools);
    const visibleCount = (status) => visible.filter((item) => item.status === status).length;
    const filters = [
      { id: "all", label: "All", count: visible.length },
      ...STATUSES.map((s) => ({ ...s, count: visibleCount(s.id) })),
      { id: "overdue", label: "Overdue", count: visible.filter(isOverdue).length },
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

    const statusMatches = (item) => activeFilter === "all" || (activeFilter === "overdue" ? isOverdue(item) : item.status === activeFilter);
    const rows = inDisplayOrder(items)
      .filter(({ item }) => matchesTools(item) && statusMatches(item))
      .map(({ item, index }) => itemRow(item, index));
    const shown = rows.length;
    if (!rows.length) {
      const cell = el("td", "no-items", toolsActive() ? "No action items match these filters." : "No action items with this status.");
      cell.colSpan = 5;
      rows.push(el("tr", "", cell));
    }
    $("items-body").replaceChildren(...rows);

    // "Showing 12 of 90 action items" and Clear filters, while anything is filtered.
    const filtering = toolsActive() || activeFilter !== "all";
    $("match-row").hidden = !filtering;
    $("match-count").textContent = filtering ? `Showing ${shown} of ${items.length} action items` : "";
    $("owner-filter").classList.toggle("is-active", Boolean(ownerFilter));
    $("due-button").classList.toggle("is-active", Boolean(dueFilter));
    $("due-button-label").textContent = dueLabel();
    if (!$("due-calendar").hidden) renderCalendar();
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
      focusSelect(document.querySelector(`#items-body select[data-index="${index}"]`));
      saveStatus(item, index);
    });
    // Each status in the list has its coloured dot, like the filters above the table.
    const statusDropdown = enhanceSelect(select, { chevron: false, optionContent: (option) => [el("span", `dot s-${option.value}`), option.textContent] });

    const note = el("div", item.note?.error ? "save-note save-error" : "save-note", item.note?.text ?? "");
    note.dataset.note = index;
    note.setAttribute("role", "status");

    const statusStack = el("div", "status-stack", el("span", `status s-${item.status}`, statusDropdown, icon("chevron")), note);

    return el("tr", item.status === "done" ? "row-done" : "",
      el("td", "", el("div", "task-title", ...highlight(item.task, searchText))),
      ownerCell(item, index),
      dueCell(item, index),
      labelledCell("Status", "", statusStack),
      labelledCell("Follow-up", "", followUpCell(item, index)),
    );
  }

  // ---- Editing the owner and due date ----
  // Clicking an owner or due date opens a small editor under it. Changes are saved in
  // the meeting's status file on top of Claude's values, which stay visible on hover ("Edited").
  // Reset puts Claude's value back. Only one editor is open at a time.
  let editing = null; // { index, field: "owner" | "due" }
  const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const EDIT_ERRORS = {
    item_changed: "This meeting has changed since you opened it. Reload the page.",
    not_found: "This meeting is no longer available.",
    invalid_due: "That date couldn't be saved.",
    invalid_owner: "That owner couldn't be saved.",
    due_in_past: "Pick today or a later date.",
  };

  // Labels that stand in for a person rather than name one, e.g. Fireflies' "@1" for a speaker it
  // couldn't identify, "Speaker 2", "Unknown speaker" or "Guest". Real names have at least two
  // letters (in any language) and don't start with "@".
  const PLACEHOLDER_NAME = /^(speaker|participant|attendee|guest|unknown|user)(\s+(speaker|user|participant))?\s*#?\s*\d*$/i;
  const isRealName = (name) => !name.startsWith("@") && (name.match(/\p{L}/gu)?.length ?? 0) >= 2 && !PLACEHOLDER_NAME.test(name);

  // Everyone with a real name who owns a task or speaks in the meeting, A–Z, then "Unassigned".
  function ownerChoices() {
    const names = new Map();
    const add = (name) => {
      const clean = String(name ?? "").trim();
      if (clean && !NO_OWNER.test(clean) && isRealName(clean) && !names.has(clean.toLowerCase())) names.set(clean.toLowerCase(), clean);
    };
    meeting.actionItems.forEach((item) => { add(item.owner); add(item.original?.owner); });
    speakers.forEach(add);
    return [...names.values()].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" })).concat("Unassigned");
  }

  // "Thu 5 Nov", with the year only when it isn't the meeting's, as Claude writes them.
  function dueFromDate(date) {
    const meetingYear = new Date(meeting.date ?? Date.now()).getFullYear();
    const y = date.getFullYear();
    return `${DAY_NAMES[date.getDay()]} ${date.getDate()} ${MONTH_NAMES[date.getMonth()]}${y !== meetingYear ? ` ${y}` : ""}`;
  }

  const editedField = (item, field) => Boolean(item.original) && item.original[field] !== item[field];

  // The owner or due date itself is the button: grey on hover like the Status dropdown, and a
  // click (or tap, or Enter) opens the editor. Nothing extra sits next to the text.
  function editTrigger(item, index, field, className, ...content) {
    const button = el("button", `cell-btn ${className}`, ...content);
    button.type = "button";
    button.dataset.edit = `${index}:${field}`;
    const label = field === "owner" ? "owner" : "due date";
    const value = field === "owner" ? item.owner : item.due || "none";
    const edited = editedField(item, field) ? ` (edited; originally ${item.original[field] || "none"})` : "";
    button.setAttribute("aria-label", `${field === "owner" ? "Owner" : "Due date"}: ${value}${edited}. Change ${label} of "${item.task}"`);
    button.title = `Click to change the ${label}`;
    if (editing?.index === index && editing.field === field) button.classList.add("open");
    button.setAttribute("aria-expanded", String(button.classList.contains("open")));
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (button.classList.contains("open")) stopEditing(true);
      else startEditing(index, field);
    });
    return button;
  }

  function editedBadge(item, field) {
    const original = item.original[field] || "—";
    const badge = el("span", "edited-badge", "Edited");
    const when = item.editedAt ? ` · changed ${new Date(item.editedAt).toLocaleString()}` : "";
    badge.title = `Originally: ${original}${when}`;
    badge.setAttribute("aria-label", `Edited. Originally ${original}.`);
    return badge;
  }

  function detailNote(item, index, field) {
    const note = item.detailNote?.field === field ? item.detailNote : null;
    const node = el("div", note?.error ? "save-note save-error" : "save-note", note?.text ?? "");
    node.dataset.detailNote = `${index}:${field}`;
    node.setAttribute("role", "status");
    return node;
  }

  function ownerCell(item, index) {
    // Avatar, then the name with "Edited" under it; the whole thing opens the editor.
    const text = el("span", "cell-text", el("span", "owner-name", ...highlight(item.owner, searchText)));
    if (editedField(item, "owner")) text.append(editedBadge(item, "owner"));
    const view = editTrigger(item, index, "owner", "owner", avatar(item.owner), text);
    const cell = labelledCell("Owner", "editable", view, detailNote(item, index, "owner"));
    if (editing?.index === index && editing.field === "owner") {
      const select = el("select", "cell-editor");
      select.setAttribute("aria-label", `Owner of "${item.task}"`);
      const current = NO_OWNER.test(String(item.owner ?? "").trim()) ? "Unassigned" : item.owner;
      const choices = ownerChoices();
      const selected = choices.find((name) => name.toLowerCase() === current.toLowerCase());
      // If Claude gave the task a placeholder owner (like "@1"), show it at the top as the current
      // value, greyed out, so the list doesn't pretend someone else is the owner.
      if (!selected) {
        const option = el("option", "", `${current} (current)`);
        option.value = current;
        option.disabled = option.selected = true;
        option.dataset.separator = "true";
        select.append(option);
      }
      // The current owner comes first, with a line under it; then everyone else A–Z, then Unassigned.
      const ordered = selected ? [selected, ...choices.filter((name) => name !== selected)] : choices;
      for (const name of ordered) {
        const option = el("option", "", name);
        option.value = name;
        option.selected = name === selected;
        if (name === selected) option.dataset.separator = "true";
        select.append(option);
      }
      select.addEventListener("change", () => saveDetails(item, index, "owner", { owner: select.value }));
      cell.append(editorPanel(item, index, "owner", enhanceSelect(select)));
    }
    return cell;
  }

  // A clock, "Overdue" and how late it is, e.g. "Overdue · 5 days". Shown, not chosen: it goes
  // away when the item is marked Done or given a later due date.
  function overdueTag(item) {
    if (!isOverdue(item)) return null;
    const days = overdueDays(item);
    const tag = el("span", "overdue-tag", icon("clock"), "Overdue",
      el("span", "overdue-days", ` · ${days} ${days === 1 ? "day" : "days"}`));
    tag.title = `Due ${item.due}. Set automatically; it clears when the item is marked Done.`;
    return tag;
  }

  function dueCell(item, index) {
    // The date with "Edited" under it; the whole thing opens the editor.
    const text = el("span", "cell-text", el("span", "due-text", ...highlight(item.due || "—", searchText)));
    if (editedField(item, "due")) text.append(editedBadge(item, "due"));
    const view = editTrigger(item, index, "due", "due-view", text);
    // Under the date: "Overdue · 5 days" when it's late (outside the button, so it isn't clickable).
    const stack = el("div", "due-stack", view);
    const tag = overdueTag(item);
    if (tag) {
      stack.classList.add("has-overdue");
      stack.append(tag);
    }
    const cell = labelledCell("Due", "due editable", stack, detailNote(item, index, "due"));
    if (editing?.index === index && editing.field === "due") {
      const noDate = el("button", "link-btn", "No date");
      noDate.type = "button";
      noDate.addEventListener("click", () => saveDetails(item, index, "due", { due: "—" }));
      cell.append(editorPanel(item, index, "due", dueEditorCalendar(item, index), noDate));
    }
    return cell;
  }

  // The month calendar in the due date editor, drawn by the page (the browser's own date picker
  // can't be styled), so it matches the due date filter. Click a day to save it. Days before
  // today are greyed out and can't be picked; the current due date is shown in blue.
  let editMonth = null; // first day of the month shown
  let editFocus = null; // the day that has keyboard focus

  function openDueEditor(item) {
    const today = startOfDay(new Date());
    const current = dueDate(item.due)?.date;
    editFocus = current && current >= today ? current : today;
    editMonth = new Date(editFocus.getFullYear(), editFocus.getMonth(), 1);
  }

  function dueEditorCalendar(item, index) {
    const today = startOfDay(new Date());
    const current = dueDate(item.due)?.date ?? null;
    const redraw = (focusSelector) => {
      const node = document.querySelector("#items-body .edit-cal");
      if (!node) return;
      const fresh = dueEditorCalendar(item, index);
      node.replaceWith(fresh);
      fresh.querySelector(focusSelector)?.focus();
    };
    const showMonth = (offset, focusSelector) => {
      editMonth = new Date(editMonth.getFullYear(), editMonth.getMonth() + offset, 1);
      editFocus = editMonth < today ? today : editMonth;
      redraw(focusSelector);
    };

    // No going back past the current month: every day there would be in the past.
    const prev = el("button", "cal-nav cal-prev", icon("chevron"));
    prev.type = "button";
    prev.setAttribute("aria-label", "Previous month");
    prev.disabled = editMonth.getFullYear() === today.getFullYear() && editMonth.getMonth() <= today.getMonth();
    prev.addEventListener("click", () => showMonth(-1, ".cal-prev:not(:disabled), .cal-day[tabindex='0']"));
    const next = el("button", "cal-nav cal-next", icon("chevron"));
    next.type = "button";
    next.setAttribute("aria-label", "Next month");
    next.addEventListener("click", () => showMonth(1, ".cal-next"));
    const title = el("div", "cal-title", editMonth.toLocaleDateString("en-GB", { month: "long", year: "numeric" }));
    title.setAttribute("aria-live", "polite");

    const grid = el("div", "cal-grid");
    grid.setAttribute("role", "grid");
    grid.setAttribute("aria-label", `Due date of "${item.task}"`);
    for (const name of ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]) grid.append(el("div", "cal-weekday", name));
    const first = addDays(editMonth, -((editMonth.getDay() + 6) % 7)); // the Monday on or before the 1st
    for (let i = 0; i < 42; i++) {
      const day = addDays(first, i);
      const past = day < today;
      const selected = sameDay(day, current);
      const classes = ["cal-day"];
      if (day.getMonth() !== editMonth.getMonth()) classes.push("other-month");
      if (sameDay(day, today)) classes.push("today");
      if (selected) classes.push("range-start", "range-end");
      const button = el("button", classes.join(" "), String(day.getDate()));
      button.type = "button";
      button.dataset.date = day.getTime();
      button.disabled = past;
      button.tabIndex = sameDay(day, editFocus) ? 0 : -1;
      button.setAttribute("aria-pressed", String(selected));
      button.setAttribute("aria-label", `${longDay(day)}${selected ? ", current due date" : ""}${past ? ", in the past" : ""}`);
      if (past) button.title = "Pick today or a later date";
      button.addEventListener("click", () => saveDetails(item, index, "due", { due: dueFromDate(day) }));
      grid.append(button);
    }
    // Arrow keys move between days (never before today); Enter or Space picks the focused day.
    grid.addEventListener("keydown", (event) => {
      const moves = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -7, ArrowDown: 7 };
      if (!(event.key in moves)) return;
      event.preventDefault();
      // Move from the day that has focus (it may have been reached by Tab or a click).
      const from = event.target.dataset.date ? new Date(Number(event.target.dataset.date)) : editFocus;
      const target = addDays(from, moves[event.key]);
      editFocus = target < today ? today : target;
      editMonth = new Date(editFocus.getFullYear(), editFocus.getMonth(), 1);
      redraw(".cal-day[tabindex='0']");
    });

    return el("div", "edit-cal", el("div", "cal-head", prev, title, next), grid);
  }

  // The editor under a cell: the control, then Reset (when edited) and Cancel.
  function editorPanel(item, index, field, ...controls) {
    const panel = el("div", "cell-edit", ...controls);
    if (editedField(item, field)) {
      const reset = el("button", "link-btn", "Reset");
      reset.type = "button";
      reset.title = `Back to ${item.original[field] || "—"}`;
      reset.addEventListener("click", () => saveDetails(item, index, field, { [field]: null }));
      panel.append(reset);
    }
    const cancel = el("button", "link-btn link-muted", "Cancel");
    cancel.type = "button";
    cancel.addEventListener("click", () => stopEditing(true));
    panel.append(cancel);
    panel.addEventListener("click", (event) => event.stopPropagation());
    panel.addEventListener("keydown", (event) => { if (event.key === "Escape") stopEditing(true); });
    return panel;
  }

  function startEditing(index, field) {
    editing = { index, field };
    if (field === "due") openDueEditor(meeting.actionItems[index]);
    renderActionItems();
    document.querySelector("#items-body .cell-edit :is(.dd-button, .cal-day[tabindex='0'])")?.focus();
    // Clicking an owner opens the list of names straight away: one more click picks the new owner.
    if (field === "owner") document.querySelector("#items-body .cell-edit select")?.showList?.();
  }

  function stopEditing(focus = false) {
    if (!editing) return;
    const { index, field } = editing;
    editing = null;
    renderActionItems();
    if (focus) document.querySelector(`#items-body [data-edit="${index}:${field}"]`)?.focus();
  }

  // Clicking anywhere outside the open editor closes it without saving.
  document.addEventListener("click", (event) => {
    if (editing && !event.target.closest(".cell-edit")) stopEditing();
  });

  async function saveDetails(item, index, field, change) {
    editing = null;
    item.detailNote = { field, text: "Saving…" };
    renderActionItems();
    let error = null;
    try {
      const response = await fetch(`/api/meetings/${meetingLink.id}/action-items/${index}/details`, {
        method: "PUT",
        headers: { "Content-Type": "application/json", "X-Meeting-Link": meetingLink.hash },
        body: JSON.stringify({ task: item.task, ...change }),
      });
      const result = await response.json().catch(() => ({}));
      if (response.ok) Object.assign(item, { owner: result.owner, due: result.due, original: result.original, editedAt: result.editedAt });
      else error = EDIT_ERRORS[result.error] ?? "Couldn't save. Try again.";
    } catch {
      error = "Couldn't save. Check your connection and try again.";
    }
    item.detailNote = { field, text: error ?? "Saved", error: Boolean(error) };
    fillOwnerFilter();
    renderActionItems();
    document.querySelector(`#items-body [data-edit="${index}:${field}"]`)?.focus();
    if (!error) {
      setTimeout(() => {
        if (item.detailNote?.text !== "Saved") return;
        item.detailNote = null;
        const node = document.querySelector(`#items-body [data-detail-note="${index}:${field}"]`);
        if (node) node.textContent = "";
      }, 2000);
    }
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
                isOverdue(item) ? { text: `${status} (${overdueText(item)})`, color: [180, 84, 10] } : status,
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

  // ---- Menus (transcript download, more speakers) ----
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

  setUpMenu($("download-button"), $("download-menu"));
  document.addEventListener("click", () => closeMenus.forEach((c) => c()));

  // ---- Dropdowns ----
  // The browser draws a <select>'s list itself and opens it upwards when there isn't room below,
  // which page code can't change. So each <select> is hidden and shown as a button with a list the
  // page draws, which always opens downwards; if there isn't room on screen, the page scrolls to
  // make room instead. The hidden <select> stays the source of truth: its options, value and
  // change events work as before, and setting its value updates the button.
  // The list is position: fixed so the table's scroll area can't clip it.
  let openDropdown = null; // closes the list that's open, if any
  let dropdownCount = 0;
  closeMenus.push(() => openDropdown?.());
  const spacer = el("div", "dd-spacer"); // room below the page for a list opened near its end
  spacer.setAttribute("aria-hidden", "true");
  const nativeValue = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value");

  // options: chevron (default true) adds a chevron to the button; optionContent(option) returns
  // what to show for an option (default: its text).
  function enhanceSelect(select, { chevron = true, optionContent = (option) => [option.textContent] } = {}) {
    const id = `dd-${++dropdownCount}`;
    const label = el("span", "dd-label");
    const button = el("button", "", label);
    if (chevron) button.append(icon("chevron"));
    button.type = "button";
    button.id = `${id}-button`;
    button.setAttribute("role", "combobox");
    button.setAttribute("aria-haspopup", "listbox");
    button.setAttribute("aria-controls", `${id}-list`);
    button.setAttribute("aria-expanded", "false");
    const list = el("ul", "dd-list");
    list.id = `${id}-list`;
    list.hidden = true;
    list.setAttribute("role", "listbox");
    select.hidden = true;
    select.tabIndex = -1;
    // A <select> already on the page (owner filter, sort) is swapped for the wrapper in place.
    const wrap = el("span", "dd");
    select.replaceWith(wrap);
    wrap.append(select, button, list);
    let active = -1; // option index highlighted in the open list

    // The button shows the chosen option. Every option's text sits in the same spot, invisible, so
    // the button is as wide as the longest one (like a <select>) and doesn't jump when it changes.
    function sync() {
      button.className = `dd-button ${select.className}`.trim();
      button.setAttribute("aria-label", select.getAttribute("aria-label") ?? "");
      button.disabled = select.disabled;
      label.replaceChildren(...[...select.options].map((option, i) =>
        el("span", i === select.selectedIndex ? "dd-current" : "", option.textContent)));
    }
    Object.defineProperty(select, "value", {
      configurable: true,
      get() { return nativeValue.get.call(this); },
      set(value) { nativeValue.set.call(this, value); sync(); },
    });
    new MutationObserver(sync).observe(select, { childList: true, subtree: true, attributes: true, attributeFilter: ["class", "aria-label", "disabled"] });
    sync();

    const options = () => [...select.options];
    const usable = (i) => i >= 0 && i < select.options.length && !select.options[i].disabled;

    function setActive(i, scroll = true) {
      active = i;
      list.querySelectorAll(".dd-option").forEach((node, n) => node.classList.toggle("active", n === i));
      const node = list.children[i];
      if (node) {
        button.setAttribute("aria-activedescendant", node.id);
        if (scroll) node.scrollIntoView({ block: "nearest" });
      } else {
        button.removeAttribute("aria-activedescendant");
      }
    }

    // Right under the button, never above it. Narrower than the screen, and no taller than the
    // room left below the button (the list scrolls if it has more options).
    function place() {
      const rect = button.getBoundingClientRect();
      list.style.minWidth = `${rect.width}px`;
      list.style.top = `${rect.bottom + 4}px`;
      list.style.maxHeight = `${Math.max(120, Math.min(300, innerHeight - rect.bottom - 12))}px`;
      list.style.left = `${Math.max(8, Math.min(rect.left, innerWidth - list.offsetWidth - 8))}px`;
    }

    function close() {
      if (list.hidden) return;
      list.hidden = true;
      button.setAttribute("aria-expanded", "false");
      button.removeAttribute("aria-activedescendant");
      removeEventListener("scroll", place, true);
      removeEventListener("resize", place);
      spacer.remove();
      if (openDropdown === close) openDropdown = null;
    }

    function open() {
      closeMenus.forEach((c) => c());
      list.replaceChildren(...options().map((option, i) => {
        const item = el("li", "dd-option", ...optionContent(option));
        item.id = `${id}-${i}`;
        item.setAttribute("role", "option");
        item.setAttribute("aria-selected", String(i === select.selectedIndex));
        if (option.disabled) item.setAttribute("aria-disabled", "true");
        // An option marked data-separator gets a line under it (e.g. the current owner, listed first).
        if (option.dataset.separator) item.classList.add("dd-separated");
        // Keep focus on the button while clicking an option.
        item.addEventListener("mousedown", (event) => event.preventDefault());
        item.addEventListener("mouseenter", () => { if (!option.disabled) setActive(i, false); });
        item.addEventListener("click", (event) => {
          event.stopPropagation();
          if (!option.disabled) choose(i);
        });
        return item;
      }));
      list.hidden = false;
      button.setAttribute("aria-expanded", "true");
      openDropdown = close;
      // Not enough room below? Scroll the page up so the list fits under the button. Near the end of
      // the page there may be nothing left to scroll, so add space below the page while it's open.
      list.style.maxHeight = "";
      const room = innerHeight - button.getBoundingClientRect().bottom - 12;
      const needed = Math.min(300, list.offsetHeight); // its full height, border included
      if (needed > room) {
        const scrollable = document.documentElement.scrollHeight - innerHeight - scrollY;
        if (needed - room > scrollable) {
          spacer.style.height = `${Math.ceil(needed - room - scrollable)}px`;
          document.body.append(spacer);
        }
        scrollBy(0, needed - room);
      }
      place();
      addEventListener("scroll", place, true);
      addEventListener("resize", place);
      setActive(usable(select.selectedIndex) ? select.selectedIndex : options().findIndex((o) => !o.disabled));
    }

    // Lets other code open the list, e.g. the owner editor as soon as it appears.
    select.showList = () => { if (list.hidden) open(); };

    function choose(i) {
      close();
      button.focus();
      if (i === select.selectedIndex) return;
      select.selectedIndex = i;
      sync();
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }

    // Moves the highlight to the next usable option in a direction, skipping disabled ones.
    function step(from, by) {
      for (let i = from + by; i >= 0 && i < select.options.length; i += by) if (usable(i)) return i;
      return from;
    }

    let typed = "", typedAt = 0;
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      if (list.hidden) open();
      else close();
    });
    button.addEventListener("keydown", (event) => {
      const isOpen = !list.hidden;
      const last = select.options.length;
      if (["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) {
        event.preventDefault();
        if (!isOpen) return open();
        if (event.key === "ArrowDown") setActive(step(active, 1));
        else if (event.key === "ArrowUp") setActive(step(active, -1));
        else if (event.key === "Home") setActive(step(-1, 1));
        else setActive(step(last, -1));
      } else if ((event.key === "Enter" || event.key === " ") && isOpen) {
        event.preventDefault();
        if (usable(active)) choose(active);
      } else if (event.key === "Escape" && isOpen) {
        // Only closes the list; a second Escape reaches whatever the dropdown sits in.
        event.preventDefault();
        event.stopPropagation();
        close();
      } else if (event.key === "Tab") {
        close();
      } else if (event.key.length === 1 && /\S/.test(event.key) && !event.ctrlKey && !event.metaKey && !event.altKey) {
        // Typing jumps to the first option starting with what was typed.
        typed = Date.now() - typedAt > 700 ? event.key : typed + event.key;
        typedAt = Date.now();
        const match = options().findIndex((o, i) => usable(i) && o.textContent.toLowerCase().startsWith(typed.toLowerCase()));
        if (match >= 0) {
          if (!isOpen) open();
          setActive(match);
        }
      }
    });
    return wrap;
  }

  // Puts focus on the button that stands in for a <select>.
  const focusSelect = (select) => select?.parentElement?.querySelector(".dd-button")?.focus();

  enhanceSelect($("owner-filter"));
  enhanceSelect($("sort-select"));
  // The "Connect GitHub" button in the top bar doesn't do anything yet.

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
    fillOwnerFilter();
    renderActionItems();
    renderTranscript();
    $("transcript-search").addEventListener("input", (event) => renderTranscript(event.target.value));
    $("item-search").addEventListener("input", (event) => {
      searchText = event.target.value.trim().toLowerCase();
      renderActionItems();
    });
    $("owner-filter").addEventListener("change", (event) => {
      ownerFilter = event.target.value;
      renderActionItems();
    });
    setUpCalendar();
    $("clear-filters").addEventListener("click", clearFilters);
    $("download-text").addEventListener("click", downloadTranscriptText);
    $("download-pdf").addEventListener("click", downloadTranscriptPdf);
    $("export-button").addEventListener("click", exportMeetingPdf);
    $("notice").hidden = true;
    $("page").hidden = false;
  }

  load();
})();
