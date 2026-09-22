/**
 * create-request.js
 * ---------------------------------------------------------------------------
 * Controller for create-request.html — create, edit (draft / returned_to_
 * requester), and view (everything else) for a single Structural Change
 * Request. All reads/writes go through js/request-service.js (mock-backed
 * for now, same shape the real Supabase calls will have later).
 *
 * Single form-state object for the whole page, written to the data layer
 * only on "Save Draft" / "Submit" — never per-field.
 * ---------------------------------------------------------------------------
 */

const MIN_JUSTIFICATION_LENGTH = 0;
const MIN_ANSWER_LENGTH = 0;

const pageState = {
  mode: "create", // "create" | "edit" | "view"
  requestId: null,
  step: 1,
  profile: null,
  hrbpOptions: [],
  request: null, // populated when editing/viewing an existing request
  form: {
    category: "",
    change_description: "",
    justification: "",
    requested_effective_date: "",
    assigned_hrbp_id: "",
    answers: {}, // question_key -> free-text description
    selections: {}, // question_key -> predefined options ticked in the picker
  },
  saving: false,
};

async function initCreateRequestPage() {
  guardPage("Manager");
  document.getElementById("cancel-button").addEventListener("click", handleCancel);

  const params = new URLSearchParams(window.location.search);
  pageState.requestId = params.get("id");

  try {
    const [profile, hrbpOptions] = await Promise.all([getMyProfile(), listActiveHrbps()]);
    pageState.profile = profile;
    pageState.hrbpOptions = hrbpOptions;
    document.getElementById("header-manager-name").textContent = profile.full_name;

    if (pageState.requestId) {
      pageState.request = await getRequestById(pageState.requestId);
      const editableStatuses = ["draft", "returned_to_requester"];
      pageState.mode = editableStatuses.indexOf(pageState.request.status) !== -1 ? "edit" : "view";
      hydrateFormFromRequest(pageState.request);
    } else {
      pageState.mode = "create";
    }
  } catch (error) {
    showLoadError(error.message || "Could not load this request.");
    return;
  }

  if (pageState.mode === "view") {
    renderViewMode();
  } else {
    document.getElementById("sticky-footer").classList.remove("hidden");
    document.getElementById("progress-track").classList.remove("hidden");
    wireFooterButtons();
    renderStep(1);
  }
}

function hydrateFormFromRequest(request) {
  pageState.form.category = request.category;
  pageState.form.change_description = request.change_description || "";
  pageState.form.justification = request.justification || "";
  pageState.form.requested_effective_date = request.requested_effective_date || "";
  pageState.form.assigned_hrbp_id = request.assigned_hrbp_id || "";
  const answers = {};
  const selections = {};
  request.answers.forEach((answer) => {
    answers[answer.question_key] = answer.answer || "";
    selections[answer.question_key] = answer.selected_options || [];
  });
  pageState.form.answers = answers;
  pageState.form.selections = selections;
}

function showLoadError(message) {
  document.getElementById("page-loading").remove();
  const main = document.getElementById("request-main");
  const card = document.createElement("section");
  card.className = "card";
  const errorEl = document.createElement("p");
  errorEl.className = "error-message";
  errorEl.textContent = message;
  card.appendChild(errorEl);
  main.appendChild(card);
}

function handleCancel() {
  const hasContent = pageState.form.change_description || pageState.form.justification;
  if (hasContent) {
    openConfirmModal({
      title: "Leave This Request?",
      message: "Any unsaved changes will be lost.",
      confirmLabel: "Leave",
      onConfirm: async () => {
        window.location.href = "manager.html";
      },
    });
    return;
  }
  window.location.href = "manager.html";
}

// =============================================================================
// Stepped create/edit flow
// =============================================================================

function wireFooterButtons() {
  document.getElementById("save-draft-button").addEventListener("click", handleSaveDraft);
  document.getElementById("back-step-button").addEventListener("click", () => renderStep(pageState.step - 1));
  document.getElementById("next-step-button").addEventListener("click", handleNextStep);
  document.getElementById("submit-button").addEventListener("click", handleSubmit);
}

function updateProgressIndicator() {
  document.querySelectorAll(".progress-step").forEach((stepEl) => {
    const stepNumber = Number(stepEl.dataset.step);
    stepEl.classList.toggle("completed", stepNumber < pageState.step);
    stepEl.classList.toggle("active", stepNumber === pageState.step);
  });
}

function updateFooterForStep() {
  const backButton = document.getElementById("back-step-button");
  const nextButton = document.getElementById("next-step-button");
  const submitButton = document.getElementById("submit-button");
  const saveDraftButton = document.getElementById("save-draft-button");

  backButton.classList.toggle("hidden", pageState.step === 1);
  nextButton.classList.toggle("hidden", pageState.step === 3);
  submitButton.classList.toggle("hidden", pageState.step !== 3);
  saveDraftButton.classList.toggle("hidden", pageState.step === 3);
  nextButton.textContent = pageState.step === 2 ? "Review →" : "Next →";
}

function renderStep(step) {
  pageState.step = step;
  updateProgressIndicator();
  updateFooterForStep();

  const main = document.getElementById("request-main");
  main.innerHTML = "";

  if (step === 1) main.appendChild(buildStep1());
  if (step === 2) main.appendChild(buildStep2());
  if (step === 3) main.appendChild(buildStep3());

  window.scrollTo({ top: 0, behavior: "smooth" });
}

// ---------- Step 1: profile (read-only) + business justification ----------

function buildStep1() {
  const fragment = document.createDocumentFragment();

  if (pageState.mode === "edit" && pageState.request && pageState.request.status === "returned_to_requester") {
    fragment.appendChild(buildReturnedBanner(pageState.request));
  }

  const profileCard = document.createElement("section");
  profileCard.className = "card";
  const profileHeading = document.createElement("h2");
  profileHeading.textContent = "Request Details";
  const profileSubtitle = document.createElement("p");
  profileSubtitle.className = "section-subtitle";
  profileSubtitle.textContent = "Loaded automatically from your profile — these fields cannot be edited.";
  const grid = document.createElement("div");
  grid.className = "info-grid";

  [
    ["Full Name", pageState.profile.full_name],
    ["Company", pageState.profile.company],
    ["Job Title", pageState.profile.job_title],
    ["Division", pageState.profile.division],
    ["Department", pageState.profile.department],
    ["Subdepartment", pageState.profile.subdepartment],
    ["Unit", pageState.profile.unit],
    ["Subunit", pageState.profile.subunit],
  ].forEach(([label, value]) => {
    const field = document.createElement("div");
    field.className = "info-field";
    const labelEl = document.createElement("label");
    labelEl.textContent = label;
    const input = document.createElement("input");
    input.type = "text";
    input.value = value || "—";
    input.disabled = true;
    input.readOnly = true;
    field.appendChild(labelEl);
    field.appendChild(input);
    grid.appendChild(field);
  });

  profileCard.appendChild(profileHeading);
  profileCard.appendChild(profileSubtitle);
  profileCard.appendChild(grid);
  fragment.appendChild(profileCard);

  const justificationCard = document.createElement("section");
  justificationCard.className = "card";
  const jHeading = document.createElement("h2");
  jHeading.textContent = "Business Reason";
  justificationCard.appendChild(jHeading);

  const form = document.createElement("div");
  form.className = "justification-form";

  form.appendChild(buildSelectField({
    id: "field-category",
    label: "Structural Change Category",
    required: true,
    value: pageState.form.category,
    options: REQUEST_CATEGORY_ORDER.map((key) => ({ value: key, label: CATEGORY_LABELS[key] })),
    placeholder: "Select a category…",
    onChange: (value) => { pageState.form.category = value; },
  }));

  form.appendChild(buildTextareaField({
    id: "field-change-description",
    label: "Change Description",
    required: true,
    minLength: MIN_JUSTIFICATION_LENGTH,
    value: pageState.form.change_description,
    onChange: (value) => { pageState.form.change_description = value; },
  }));

  form.appendChild(buildTextareaField({
    id: "field-justification",
    label: "Reason",
    required: true,
    minLength: MIN_JUSTIFICATION_LENGTH,
    value: pageState.form.justification,
    onChange: (value) => { pageState.form.justification = value; },
  }));

  const row = document.createElement("div");
  row.className = "form-field-row";
  row.appendChild(buildDateField({
    id: "field-effective-date",
    label: "Requested Effective Date",
    required: true,
    value: pageState.form.requested_effective_date,
    onChange: (value) => { pageState.form.requested_effective_date = value; },
  }));
  row.appendChild(buildSelectField({
    id: "field-hrbp",
    label: "Assigned HRBP",
    required: true,
    value: pageState.form.assigned_hrbp_id,
    options: pageState.hrbpOptions.map((hrbp) => ({ value: hrbp.id, label: hrbp.full_name })),
    placeholder: "Select an HRBP…",
    onChange: (value) => { pageState.form.assigned_hrbp_id = value; },
  }));
  form.appendChild(row);

  justificationCard.appendChild(form);
  fragment.appendChild(justificationCard);

  return fragment;
}

function buildReturnedBanner(request) {
  const lastReturn = request.history.slice().reverse().find((entry) => entry.to_status === "returned_to_requester");
  const banner = document.createElement("div");
  banner.className = "error-message";
  banner.style.marginBottom = "0";
  const strong = document.createElement("strong");
  strong.textContent = "This request was returned for changes. ";
  banner.appendChild(strong);
  const span = document.createElement("span");
  span.textContent = lastReturn && lastReturn.comment
    ? lastReturn.comment
    : "See the flagged answer(s) on the next step for what needs to change.";
  banner.appendChild(span);
  const wrap = document.createElement("div");
  wrap.className = "card";
  wrap.style.padding = "16px 20px";
  wrap.appendChild(banner);
  return wrap;
}

// ---------- Step 2: dynamic questions ----------

function buildStep2() {
  const card = document.createElement("section");
  card.className = "card";

  const heading = document.createElement("h2");
  heading.textContent = CATEGORY_LABELS[pageState.form.category] || "Questions";
  card.appendChild(heading);

  const questions = QUESTION_BANK[pageState.form.category] || [];
  if (questions.length === 0) {
    const placeholder = document.createElement("p");
    placeholder.className = "questions-placeholder";
    placeholder.textContent = "No questions are configured for this category yet.";
    card.appendChild(placeholder);
    return card;
  }

  questions.forEach((question) => {
    card.appendChild(buildQuestionField(question));
  });

  return card;
}

function buildQuestionField(question) {
  const wrapper = document.createElement("div");
  wrapper.className = "question-field";
  wrapper.id = `question-${question.key}`;

  const label = document.createElement("p");
  label.className = "question-label";
  label.textContent = question.text + " *";
  wrapper.appendChild(label);

  const priorAnswer = pageState.request ? pageState.request.answers.find((a) => a.question_key === question.key) : null;
  if (priorAnswer && priorAnswer.hrbp_verdict === "insufficient") {
    const note = document.createElement("p");
    note.className = "prior-comment-note";
    note.textContent = `HRBP feedback: ${priorAnswer.hrbp_comment || "This answer needs more detail."}`;
    wrapper.appendChild(note);
  }

  const textarea = document.createElement("textarea");
  textarea.className = "question-textarea";
  textarea.rows = 4;
  textarea.value = pageState.form.answers[question.key] || "";
  textarea.addEventListener("input", () => {
    pageState.form.answers[question.key] = textarea.value;
    updateCharCount(charCount, textarea.value.length);
    clearFieldError(wrapper);
  });

  // Questions with predefined options (the `hints` list in
  // request-questions.js) get three fields, top to bottom: a searchable
  // multi-select dropdown, the chips of what's been selected, and the
  // free-text description. The picks are stored separately from the
  // description (request_answers.selected_options), never pasted into it.
  if (question.hints && question.hints.length > 0) {
    const picker = buildOptionPicker(question.hints, {
      selected: pageState.form.selections[question.key] || [],
      onChange: (selected) => {
        pageState.form.selections[question.key] = selected;
        clearFieldError(wrapper);
      },
    });
    wrapper.appendChild(picker);

    const descriptionCaption = document.createElement("p");
    descriptionCaption.className = "field-caption";
    descriptionCaption.textContent = "Your description";
    wrapper.appendChild(descriptionCaption);
    textarea.rows = 5;
    textarea.placeholder = "Add details in your own words…";
  }

  wrapper.appendChild(textarea);

  const charCount = document.createElement("p");
  charCount.className = "char-count";
  updateCharCount(charCount, textarea.value.length);
  wrapper.appendChild(charCount);

  const errorText = document.createElement("p");
  errorText.className = "error-text hidden";
  wrapper.appendChild(errorText);

  return wrapper;
}

function updateCharCount(el, length) {
  el.textContent = MIN_ANSWER_LENGTH > 0 ? `${length} / ${MIN_ANSWER_LENGTH} characters minimum` : `${length} characters`;
  el.classList.toggle("char-count-ok", length >= MIN_ANSWER_LENGTH);
}

// ---------- Step 3: review ----------

function buildStep3() {
  const fragment = document.createDocumentFragment();

  const summary = document.createElement("section");
  summary.className = "card";
  const heading = document.createElement("h2");
  heading.textContent = "Review Your Request";
  const subtitle = document.createElement("p");
  subtitle.className = "section-subtitle";
  subtitle.textContent = "Check everything below before submitting. You can go back to make changes.";
  summary.appendChild(heading);
  summary.appendChild(subtitle);

  summary.appendChild(buildReviewSectionTitle("Request Details"));
  const grid = document.createElement("div");
  grid.className = "info-grid";
  [
    ["Full Name", pageState.profile.full_name],
    ["Company", pageState.profile.company],
    ["Job Title", pageState.profile.job_title],
    ["Division", pageState.profile.division],
    ["Department", pageState.profile.department],
  ].forEach(([label, value]) => grid.appendChild(buildReadOnlyKeyValue(label, value)));
  summary.appendChild(grid);

  summary.appendChild(buildReviewSectionTitle("Business Reason"));
  const hrbp = pageState.hrbpOptions.find((h) => h.id === pageState.form.assigned_hrbp_id);
  const justGrid = document.createElement("div");
  justGrid.className = "info-grid";
  [
    ["Category", CATEGORY_LABELS[pageState.form.category]],
    ["Requested Effective Date", pageState.form.requested_effective_date],
    ["Assigned HRBP", hrbp ? hrbp.full_name : "—"],
  ].forEach(([label, value]) => justGrid.appendChild(buildReadOnlyKeyValue(label, value)));
  summary.appendChild(justGrid);
  summary.appendChild(buildReadOnlyParagraph("Change Description", pageState.form.change_description));
  summary.appendChild(buildReadOnlyParagraph("Reason", pageState.form.justification));

  fragment.appendChild(summary);

  const questionsCard = document.createElement("section");
  questionsCard.className = "card";
  questionsCard.appendChild(buildReviewSectionTitle("Questions & Answers"));
  (QUESTION_BANK[pageState.form.category] || []).forEach((question) => {
    questionsCard.appendChild(
      buildReadOnlyAnswer(question.text, {
        answer: pageState.form.answers[question.key],
        selected_options: pageState.form.selections[question.key],
      })
    );
  });
  fragment.appendChild(questionsCard);

  return fragment;
}

// buildReviewSectionTitle / buildReadOnlyKeyValue / buildReadOnlyParagraph /
// buildReadOnlyVerdictRow / describeHistoryAction / formatDate(Time) all
// live in js/workflow-shared.js, shared with the HRBP/OD review pages.

// =============================================================================
// Field builders (Step 1)
// =============================================================================

function buildSelectField(config) {
  const group = document.createElement("div");
  group.className = "form-group";
  const label = document.createElement("label");
  label.setAttribute("for", config.id);
  label.textContent = config.label + (config.required ? " *" : "");
  const select = document.createElement("select");
  select.id = config.id;
  select.className = "field-select";
  const placeholderOption = document.createElement("option");
  placeholderOption.value = "";
  placeholderOption.textContent = config.placeholder || "Select…";
  select.appendChild(placeholderOption);
  config.options.forEach((option) => {
    const optionEl = document.createElement("option");
    optionEl.value = option.value;
    optionEl.textContent = option.label;
    if (option.value === config.value) optionEl.selected = true;
    select.appendChild(optionEl);
  });
  select.addEventListener("change", () => {
    config.onChange(select.value);
    clearFieldError(group);
  });
  const errorText = document.createElement("p");
  errorText.className = "error-text hidden";
  group.appendChild(label);
  group.appendChild(select);
  group.appendChild(errorText);
  return group;
}

function buildTextareaField(config) {
  const group = document.createElement("div");
  group.className = "form-group";
  const label = document.createElement("label");
  label.setAttribute("for", config.id);
  label.textContent = config.label + (config.required ? " *" : "");
  const textarea = document.createElement("textarea");
  textarea.id = config.id;
  textarea.className = "question-textarea";
  textarea.rows = 4;
  textarea.value = config.value || "";
  const charCount = document.createElement("p");
  charCount.className = "char-count";
  updateCharCount2(charCount, textarea.value.length, config.minLength);
  textarea.addEventListener("input", () => {
    config.onChange(textarea.value);
    updateCharCount2(charCount, textarea.value.length, config.minLength);
    clearFieldError(group);
  });
  const errorText = document.createElement("p");
  errorText.className = "error-text hidden";
  group.appendChild(label);
  group.appendChild(textarea);
  group.appendChild(charCount);
  group.appendChild(errorText);
  return group;
}

function updateCharCount2(el, length, minLength) {
  el.textContent = minLength > 0 ? `${length} / ${minLength} characters minimum` : `${length} characters`;
  el.classList.toggle("char-count-ok", length >= minLength);
}

function buildDateField(config) {
  const group = document.createElement("div");
  group.className = "form-group";
  const label = document.createElement("label");
  label.setAttribute("for", config.id);
  label.textContent = config.label + (config.required ? " *" : "");
  const input = document.createElement("input");
  input.type = "date";
  input.id = config.id;
  input.min = new Date().toISOString().slice(0, 10);
  input.value = config.value || "";
  input.addEventListener("change", () => {
    config.onChange(input.value);
    clearFieldError(group);
  });
  const errorText = document.createElement("p");
  errorText.className = "error-text hidden";
  group.appendChild(label);
  group.appendChild(input);
  group.appendChild(errorText);
  return group;
}

function showFieldError(container, message) {
  container.classList.add("field-error");
  const errorEl = container.querySelector(".error-text");
  if (errorEl) {
    errorEl.textContent = message;
    errorEl.classList.remove("hidden");
  }
}

function clearFieldError(container) {
  container.classList.remove("field-error");
  const errorEl = container.querySelector(".error-text");
  if (errorEl) {
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }
}

// =============================================================================
// Validation
// =============================================================================

function validateStep1() {
  let valid = true;
  const today = new Date().toISOString().slice(0, 10);

  if (!pageState.form.category) {
    showFieldError(document.getElementById("field-category").closest(".form-group"), "Please select a category.");
    valid = false;
  }
  if (!pageState.form.change_description || pageState.form.change_description.trim().length < MIN_JUSTIFICATION_LENGTH) {
    showFieldError(document.getElementById("field-change-description").closest(".form-group"), `Please enter at least ${MIN_JUSTIFICATION_LENGTH} characters.`);
    valid = false;
  }
  if (!pageState.form.justification || pageState.form.justification.trim().length < MIN_JUSTIFICATION_LENGTH) {
    showFieldError(document.getElementById("field-justification").closest(".form-group"), `Please enter at least ${MIN_JUSTIFICATION_LENGTH} characters.`);
    valid = false;
  }
  if (!pageState.form.requested_effective_date) {
    showFieldError(document.getElementById("field-effective-date").closest(".form-group"), "Please select a date.");
    valid = false;
  } else if (pageState.form.requested_effective_date < today) {
    showFieldError(document.getElementById("field-effective-date").closest(".form-group"), "Date cannot be in the past.");
    valid = false;
  }
  if (!pageState.form.assigned_hrbp_id) {
    showFieldError(document.getElementById("field-hrbp").closest(".form-group"), "Please select an HRBP.");
    valid = false;
  }

  return valid;
}

function validateStep2() {
  let valid = true;
  const questions = QUESTION_BANK[pageState.form.category] || [];
  questions.forEach((question) => {
    const value = (pageState.form.answers[question.key] || "").trim();
    const wrapper = document.getElementById(`question-${question.key}`);
    if (value.length < MIN_ANSWER_LENGTH) {
      showFieldError(wrapper, `Please enter at least ${MIN_ANSWER_LENGTH} characters.`);
      valid = false;
    }
  });
  return valid;
}

function handleNextStep() {
  if (pageState.step === 1) {
    if (!validateStep1()) return;
    const hasQuestions = (QUESTION_BANK[pageState.form.category] || []).length > 0;
    renderStep(hasQuestions ? 2 : 3);
    return;
  }
  if (pageState.step === 2) {
    if (!validateStep2()) return;
    renderStep(3);
  }
}

// =============================================================================
// Save Draft / Submit
// =============================================================================

function buildAnswersPayload() {
  const questions = QUESTION_BANK[pageState.form.category] || [];
  return questions.map((question, index) => ({
    question_key: question.key,
    question_text: question.text,
    answer: pageState.form.answers[question.key] || "",
    selected_options: pageState.form.selections[question.key] || [],
    sort_order: index,
  }));
}

async function handleSaveDraft() {
  if (pageState.saving) return;
  pageState.saving = true;
  const button = document.getElementById("save-draft-button");
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Saving…";

  try {
    const id = await saveRequestDraft({
      id: pageState.requestId,
      category: pageState.form.category,
      change_description: pageState.form.change_description,
      justification: pageState.form.justification,
      requested_effective_date: pageState.form.requested_effective_date || null,
      assigned_hrbp_id: pageState.form.assigned_hrbp_id || null,
      answers: buildAnswersPayload(),
    });
    pageState.requestId = id;
    history.replaceState(null, "", `create-request.html?id=${encodeURIComponent(id)}`);
    showSuccessToast("Draft saved.");
  } catch (error) {
    showErrorToast(error.message || "Could not save this draft.");
  } finally {
    pageState.saving = false;
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

async function handleSubmit() {
  if (pageState.saving) return;
  if (!validateStep1() || !validateStep2()) {
    showErrorToast("Please fix the highlighted fields before submitting.");
    renderStep(1);
    return;
  }

  pageState.saving = true;
  const button = document.getElementById("submit-button");
  const originalLabel = button.textContent;
  button.disabled = true;
  button.textContent = "Submitting…";

  try {
    const id = await saveRequestDraft({
      id: pageState.requestId,
      category: pageState.form.category,
      change_description: pageState.form.change_description,
      justification: pageState.form.justification,
      requested_effective_date: pageState.form.requested_effective_date || null,
      assigned_hrbp_id: pageState.form.assigned_hrbp_id || null,
      answers: buildAnswersPayload(),
    });
    await submitStructuralRequest(id);
    showSuccessToast("Request submitted.");
    setTimeout(() => {
      window.location.href = "manager.html";
    }, 700);
  } catch (error) {
    showErrorToast(error.message || "Could not submit this request.");
    pageState.saving = false;
    button.disabled = false;
    button.textContent = originalLabel;
  }
}

// =============================================================================
// View mode (submitted / in review / returned-only-to-others / approved / rejected)
// =============================================================================

function renderViewMode() {
  document.getElementById("page-title").textContent = `${CATEGORY_LABELS[pageState.request.category]} · ${MANAGER_STATUS_LABELS[pageState.request.status]}`;

  const main = document.getElementById("request-main");
  main.innerHTML = "";
  main.className = "request-main review-layout";

  const request = pageState.request;
  main.appendChild(buildReviewMetaBar(request, MANAGER_STATUS_LABELS));

  const detailsCard = document.createElement("section");
  detailsCard.className = "card";
  detailsCard.appendChild(buildReviewSectionTitle("Business Reason"));
  detailsCard.appendChild(buildReadOnlyParagraph("Change Description", request.change_description));
  detailsCard.appendChild(buildReadOnlyParagraph("Reason", request.justification));
  main.appendChild(detailsCard);

  const answersCard = document.createElement("section");
  answersCard.className = "card";
  answersCard.appendChild(buildReviewSectionTitle("Questions & Answers"));
  request.answers.forEach((answer) => {
    const answerCard = document.createElement("div");
    answerCard.className = "review-answer-card";
    const questionText = document.createElement("p");
    questionText.className = "review-question-text";
    questionText.textContent = answer.question_text;
    const answerText = document.createElement("p");
    answerText.className = "review-answer-text";
    fillAnswerContent(answerText, answer);
    answerCard.appendChild(questionText);
    answerCard.appendChild(answerText);

    if (answer.hrbp_verdict) {
      answerCard.appendChild(buildReadOnlyVerdictRow("HRBP", answer.hrbp_verdict, answer.hrbp_comment));
    }
    if (answer.od_verdict) {
      answerCard.appendChild(buildReadOnlyVerdictRow("OD", answer.od_verdict, answer.od_comment));
    }
    answersCard.appendChild(answerCard);
  });
  main.appendChild(answersCard);

  const verdictHistoryCard = buildVerdictHistoryCard(request.verdict_history);
  if (verdictHistoryCard) main.appendChild(verdictHistoryCard);

  main.appendChild(buildApprovalTrailCard(request.history));

  const actionsRow = document.createElement("div");
  actionsRow.className = "content-header-row";
  actionsRow.style.marginTop = "4px";
  const backLink = document.createElement("a");
  backLink.href = "manager.html";
  backLink.className = "btn-secondary";
  backLink.style.width = "auto";
  backLink.style.textDecoration = "none";
  backLink.style.display = "inline-flex";
  backLink.style.alignItems = "center";
  backLink.textContent = "← Back to My Requests";
  actionsRow.appendChild(backLink);

  if (request.status === "approved") {
    const exportButton = document.createElement("button");
    exportButton.type = "button";
    exportButton.className = "btn-primary";
    exportButton.style.width = "auto";
    exportButton.textContent = "Export PDF";
    exportButton.addEventListener("click", () => exportRequestToPdf(request));
    actionsRow.appendChild(exportButton);
  }
  main.appendChild(actionsRow);
}
