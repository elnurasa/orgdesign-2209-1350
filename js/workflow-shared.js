/**
 * workflow-shared.js
 * ---------------------------------------------------------------------------
 * Small presentational helpers shared by every Structural Change Request
 * page (manager's list + form, HRBP/OD inboxes + review pages) — pulled out
 * here instead of copy-pasted into each controller.
 * ---------------------------------------------------------------------------
 */

/**
 * @param {string} isoString
 * @returns {string} e.g. "Jul 21, 2026"
 */
function formatDate(isoString) {
  try {
    return new Date(isoString).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  } catch (error) {
    return isoString;
  }
}

/**
 * @param {string} isoString
 * @returns {string} e.g. "Jul 21, 2026, 2:05 PM"
 */
function formatDateTime(isoString) {
  try {
    return new Date(isoString).toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch (error) {
    return isoString;
  }
}

const HISTORY_ACTION_DESCRIPTIONS = {
  created: "created this request as a draft",
  submitted: "submitted this request",
  opened: "started reviewing this request",
  forwarded_to_od: "forwarded this request to OD",
  returned_to_requester: "returned this request to the requester",
  return_to_hrbp: "returned this request to HRBP",
  approve: "approved this request",
  reject: "rejected this request",
  withdrawn: "withdrew this request",
};

/**
 * @param {{action: string}} entry
 * @returns {string}
 */
function describeHistoryAction(entry) {
  return HISTORY_ACTION_DESCRIPTIONS[entry.action] || entry.action;
}

/**
 * @param {string} text
 * @returns {HTMLElement}
 */
function buildReviewSectionTitle(text) {
  const h3 = document.createElement("h3");
  h3.className = "review-section-title";
  h3.textContent = text;
  return h3;
}

/**
 * @param {string} label
 * @param {string} value
 * @returns {HTMLElement}
 */
function buildReadOnlyKeyValue(label, value) {
  const field = document.createElement("div");
  field.className = "info-field";
  const labelEl = document.createElement("label");
  labelEl.textContent = label;
  const valueEl = document.createElement("p");
  valueEl.className = "readonly-value";
  valueEl.textContent = value || "—";
  field.appendChild(labelEl);
  field.appendChild(valueEl);
  return field;
}

/**
 * @param {string} label
 * @param {string} value
 * @returns {HTMLElement}
 */
function buildReadOnlyParagraph(label, value) {
  const wrap = document.createElement("div");
  wrap.className = "readonly-paragraph";
  const labelEl = document.createElement("p");
  labelEl.className = "readonly-paragraph-label";
  labelEl.textContent = label;
  const valueEl = document.createElement("p");
  valueEl.className = "readonly-paragraph-value";
  valueEl.textContent = value || "—";
  wrap.appendChild(labelEl);
  wrap.appendChild(valueEl);
  return wrap;
}

/**
 * A read-only "HRBP: Sufficient" / "OD: Insufficient" badge + optional
 * comment, used wherever a verdict is being displayed rather than set.
 *
 * @param {"HRBP" | "OD"} actor
 * @param {"sufficient" | "insufficient"} verdict
 * @param {string} [comment]
 * @returns {HTMLElement}
 */
function buildReadOnlyVerdictRow(actor, verdict, comment) {
  const wrap = document.createElement("div");
  wrap.className = "verdict-row";
  const badge = document.createElement("span");
  badge.className = "verdict-readonly-badge " + (verdict === "sufficient" ? "badge-success" : "badge-danger");
  badge.textContent = `${actor}: ${verdict === "sufficient" ? "Sufficient" : "Insufficient"}`;
  wrap.appendChild(badge);
  if (comment) {
    const commentEl = document.createElement("span");
    commentEl.textContent = comment;
    commentEl.style.fontSize = "13px";
    commentEl.style.color = "var(--color-text-muted)";
    wrap.appendChild(commentEl);
  }
  return wrap;
}

/**
 * Renders the shared "meta bar" (status / requester / HRBP / submitted /
 * effective date) at the top of a review or view-mode page.
 *
 * @param {object} request
 * @returns {HTMLElement}
 */
function buildReviewMetaBar(request) {
  const metaBar = document.createElement("div");
  metaBar.className = "review-meta-bar";
  [
    ["Status", STATUS_LABELS[request.status]],
    ["Requester", request.requester_name],
    ["Assigned HRBP", request.hrbp_name],
    ["Submitted", request.submitted_at ? formatDate(request.submitted_at) : "Not yet submitted"],
    ["Requested Effective Date", request.requested_effective_date || "—"],
  ].forEach(([label, value]) => {
    const item = document.createElement("div");
    item.className = "review-meta-item";
    const labelEl = document.createElement("span");
    labelEl.className = "review-meta-label";
    labelEl.textContent = label;
    const valueEl = document.createElement("span");
    valueEl.textContent = value;
    item.appendChild(labelEl);
    item.appendChild(valueEl);
    metaBar.appendChild(item);
  });
  return metaBar;
}

/**
 * A searchable dropdown (text input + filtered option list) for picking one
 * of a fixed set of predefined values — used above a question's textarea
 * wherever the Business Requirements define predefined options for that
 * question, never as a replacement for the textarea itself. The single
 * component every such picker in the app should use, so they all look and
 * behave the same way.
 *
 * Selecting an option does not clear/replace anything by itself — the
 * caller's onSelect decides what happens (e.g. create-request.js appends
 * the picked value into the question's textarea, leaving the requester
 * free to edit or add to it).
 *
 * @param {string[]} options
 * @param {{placeholder?: string, onSelect: (value: string) => void}} config
 * @returns {HTMLElement}
 */
function buildSearchableDropdown(options, config) {
  const wrap = document.createElement("div");
  wrap.className = "searchable-dropdown";

  const input = document.createElement("input");
  input.type = "text";
  input.className = "searchable-dropdown-input";
  input.placeholder = config.placeholder || "Search predefined options…";
  input.autocomplete = "off";
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-expanded", "false");
  wrap.appendChild(input);

  const list = document.createElement("ul");
  list.className = "searchable-dropdown-list hidden";
  wrap.appendChild(list);

  function renderList(filterText) {
    list.innerHTML = "";
    const query = (filterText || "").trim().toLowerCase();
    const filtered = query ? options.filter((option) => option.toLowerCase().includes(query)) : options;

    if (filtered.length === 0) {
      const empty = document.createElement("li");
      empty.className = "searchable-dropdown-empty";
      empty.textContent = "No matching options";
      list.appendChild(empty);
      return;
    }

    filtered.forEach((option) => {
      const item = document.createElement("li");
      item.className = "searchable-dropdown-option";
      item.textContent = option;
      // mousedown (not click) fires before the input's blur closes the
      // list, so the selection registers instead of the list vanishing first.
      item.addEventListener("mousedown", (event) => {
        event.preventDefault();
        input.value = "";
        closeList();
        config.onSelect(option);
      });
      list.appendChild(item);
    });
  }

  function openList() {
    renderList(input.value);
    list.classList.remove("hidden");
    input.setAttribute("aria-expanded", "true");
  }

  function closeList() {
    list.classList.add("hidden");
    input.setAttribute("aria-expanded", "false");
  }

  input.addEventListener("focus", openList);
  input.addEventListener("input", () => renderList(input.value));
  input.addEventListener("blur", () => {
    setTimeout(closeList, 150); // let a pending option mousedown register first
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeList();
      input.blur();
    }
  });

  return wrap;
}

/**
 * Renders the shared "Approval Trail" card from a request's history array.
 *
 * @param {Array<object>} history
 * @returns {HTMLElement}
 */
function buildApprovalTrailCard(history) {
  const card = document.createElement("section");
  card.className = "card";
  card.appendChild(buildReviewSectionTitle("Approval Trail"));

  const list = document.createElement("div");
  list.className = "history-list";
  history.forEach((entry) => {
    const row = document.createElement("div");
    row.className = "history-row";
    const text = document.createElement("p");
    text.textContent = `${entry.actor_name} — ${describeHistoryAction(entry)}`;
    const time = document.createElement("span");
    time.className = "history-time";
    time.textContent = formatDateTime(entry.created_at);
    row.appendChild(text);
    row.appendChild(time);
    if (entry.comment) {
      const comment = document.createElement("p");
      comment.className = "history-comment";
      comment.textContent = `"${entry.comment}"`;
      row.appendChild(comment);
    }
    list.appendChild(row);
  });
  card.appendChild(list);
  return card;
}
