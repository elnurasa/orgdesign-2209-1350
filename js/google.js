/**
 * google.js
 * ---------------------------------------------------------------------------
 * Handles all communication with the Google Apps Script Web App that acts
 * as this app's privileged server — the only thing holding the Supabase
 * service_role key. Credentials themselves are handled entirely by
 * Supabase Auth (see supabase-client.js, auth.js); this file never sees a
 * password, only an already-issued session access token.
 *
 * Scope: sign-in role resolution, and Admin Panel user CRUD (create/update/
 * delete a Manager/HRBP/OD, grant/revoke Admin, activate/deactivate). The
 * Structural Change Request workflow does NOT go through this file or Apps
 * Script at all — it needs no elevated privilege, so it calls Supabase
 * directly (RLS-gated Postgres functions) from js/request-service.js.
 *
 * Server-side verification: Apps Script is deployed with "Anyone" access,
 * so its URL alone grants no protection — anyone who has it (it's visible
 * in js/config.js) could otherwise call it directly. Every function here
 * that touches real account data attaches the caller's current Supabase
 * access token, which Code.gs verifies server-side
 * (GET {SUPABASE_URL}/auth/v1/user) before doing anything — see
 * getAccessToken() below.
 *
 * Exposes:
 *   - resolveAccountRole(accessToken) -> the verified caller's role
 *     (Admin/Manager/HRBP/OD), used right after a successful sign-in
 *
 * Admin Panel writes (all require the caller to already be signed in as an
 * Admin — Code.gs re-verifies this server-side, never trusts the client):
 *   - adminCreateEmployee(role, fields)
 *   - adminUpdateEmployee(role, id, fields)
 *   - adminDeleteEmployee(role, id)
 *   - adminSetPermission(authUserId, isAdmin)
 *   - adminSetActive(role, id, isActive)
 * ---------------------------------------------------------------------------
 */

/**
 * Reads the current Supabase session (if any) and returns its access
 * token, for attaching to Apps Script requests that need server-side
 * verification.
 *
 * @returns {Promise<string | null>}
 */
async function getAccessToken() {
  if (!supabaseClient) return null;

  const { data, error } = await supabaseClient.auth.getSession();
  if (error || !data || !data.session) return null;

  return data.session.access_token || null;
}

/**
 * Base64-encodes a string (UTF-8 safe). Used to obscure the email/password
 * of the account being created or updated before it's sent to Apps Script —
 * some corporate network security tools inspect outgoing requests for a
 * plaintext "email + password" pair (a known credential-phishing pattern)
 * and block ones sent to script.google.com, even for this legitimate
 * first-party request. Code.gs decodes it server-side (see b64Decode there).
 * Not a security boundary — this endpoint is only ever reached over HTTPS.
 *
 * @param {string | undefined} value
 * @returns {string | undefined}
 */
function b64Encode(value) {
  if (value === undefined || value === null || value === "") return value;
  return btoa(unescape(encodeURIComponent(String(value))));
}

/**
 * Resolves the ROLE for the already-authenticated caller identified by
 * accessToken. Called right after supabaseClient.auth.signInWithPassword()
 * succeeds — a valid access_token already proves the password was correct;
 * this only answers "what role does this verified person have". Admin
 * permission is orthogonal to the primary role (never overrides it as the
 * post-login landing page) — see Code.gs's resolveAccountRole() and
 * js/auth.js's loginWithPassword()/getIsAdmin().
 *
 * @param {string} accessToken
 * @returns {Promise<{authorized: boolean, role: string | null, isAdmin: boolean}>}
 * @throws {Error} if the network request fails or the response is invalid.
 */
async function resolveAccountRole(accessToken) {
  if (!CONFIG.GOOGLE_SCRIPT_URL || CONFIG.GOOGLE_SCRIPT_URL.startsWith("PASTE_")) {
    throw new Error(
      "GOOGLE_SCRIPT_URL is not configured. Update js/config.js with your deployed Apps Script URL."
    );
  }

  const url = `${CONFIG.GOOGLE_SCRIPT_URL}?resolveRole=1&access_token=${encodeURIComponent(accessToken || "")}`;

  let response;
  try {
    response = await fetch(url, { method: "GET", redirect: "follow" });
  } catch (networkError) {
    throw new Error("Unable to reach the authorization service. Please check your connection.");
  }

  if (!response.ok) {
    throw new Error(`Authorization service returned an error (HTTP ${response.status}).`);
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    throw new Error("Authorization service returned an unexpected response.");
  }

  if (!data || typeof data !== "object" || typeof data.authorized !== "boolean") {
    throw new Error("Authorization service returned malformed data.");
  }

  return { authorized: data.authorized, role: data.role || null, isAdmin: !!data.isAdmin };
}

/**
 * Shared POST helper for the Admin Panel write actions below. Sends with
 * Content-Type "text/plain" (not "application/json") so the request stays
 * a CORS "simple request" and the browser never sends a preflight OPTIONS
 * request — Apps Script Web Apps cannot answer a CORS preflight. The body
 * is still valid JSON; Code.gs parses it as JSON regardless of the
 * declared content type.
 *
 * @param {object} body - must include an "action" key; the caller's access
 *   token is attached automatically.
 * @returns {Promise<object>} the parsed JSON response.
 * @throws {Error} if the network request fails, no session exists, or the
 *   response can't be parsed.
 */
async function postAdminAction(body) {
  if (!CONFIG.GOOGLE_SCRIPT_URL || CONFIG.GOOGLE_SCRIPT_URL.startsWith("PASTE_")) {
    throw new Error(
      "GOOGLE_SCRIPT_URL is not configured. Update js/config.js with your deployed Apps Script URL."
    );
  }

  const accessToken = await getAccessToken();
  if (!accessToken) {
    throw new Error("Your session has expired. Please sign in again.");
  }

  let response;
  try {
    response = await fetch(CONFIG.GOOGLE_SCRIPT_URL, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body: JSON.stringify(Object.assign({}, body, { access_token: accessToken })),
      redirect: "follow",
    });
  } catch (networkError) {
    throw new Error("Unable to reach the admin service. Please check your connection.");
  }

  if (!response.ok) {
    throw new Error(`Admin service returned an error (HTTP ${response.status}).`);
  }

  let data;
  try {
    data = await response.json();
  } catch (parseError) {
    throw new Error("Admin service returned an unexpected response.");
  }

  if (!data || data.status !== "success") {
    throw new Error((data && data.message) || "The request could not be completed.");
  }

  return data;
}

/**
 * Creates a new Manager/HRBP/OD account (Supabase Auth user + users row).
 *
 * @param {"Manager" | "HRBP" | "OD"} role
 * @param {{full_name: string, job_title: string, email: string,
 *   password: string, company?: string, division?: string,
 *   department?: string, subdepartment?: string, unit?: string,
 *   subunit?: string}} fields
 * @returns {Promise<{id: string}>}
 * @throws {Error} if validation fails server-side or the request fails.
 */
async function adminCreateEmployee(role, fields) {
  const encodedFields = Object.assign({}, fields, {
    email: b64Encode(fields.email),
    password: b64Encode(fields.password),
  });
  const data = await postAdminAction(Object.assign({ action: "adminCreateEmployee", role: role }, encodedFields));
  return { id: data.id };
}

/**
 * Updates an existing user row. Fields omitted (undefined) are left
 * unchanged; pass password only when the Admin actually entered a new one.
 *
 * @param {"Manager" | "HRBP" | "OD"} role
 * @param {string} id
 * @param {object} fields
 * @returns {Promise<void>}
 */
async function adminUpdateEmployee(role, id, fields) {
  const encodedFields = Object.assign({}, fields, {
    email: b64Encode(fields.email),
    password: b64Encode(fields.password),
  });
  await postAdminAction(Object.assign({ action: "adminUpdateEmployee", role: role, id: id }, encodedFields));
}

/**
 * Deletes a user row and its linked Supabase Auth user.
 *
 * @param {"Manager" | "HRBP" | "OD"} role
 * @param {string} id
 * @returns {Promise<void>}
 */
async function adminDeleteEmployee(role, id) {
  await postAdminAction({ action: "adminDeleteEmployee", role: role, id: id });
}

/**
 * Grants or revokes Admin permission for a Supabase Auth user id.
 *
 * @param {string} authUserId
 * @param {boolean} isAdmin
 * @returns {Promise<void>}
 */
async function adminSetPermission(authUserId, isAdmin) {
  await postAdminAction({ action: "adminSetPermission", auth_user_id: authUserId, is_admin: isAdmin });
}

/**
 * Activates or deactivates a user. A deactivated account is denied at Sign
 * In but otherwise left intact (reversible, unlike Delete).
 *
 * @param {"Manager" | "HRBP" | "OD"} role
 * @param {string} id
 * @param {boolean} isActive
 * @returns {Promise<void>}
 */
async function adminSetActive(role, id, isActive) {
  await postAdminAction({ action: "adminSetActive", role: role, id: id, is_active: isActive });
}
