const tokenInput = document.getElementById("token");
const saveButton = document.getElementById("save");
const testButton = document.getElementById("test");
const grantButton = document.getElementById("grant");
const permissionWarning = document.getElementById("permission-warning");
const permissionHelp = document.getElementById("permission-help");
const statusOutput = document.getElementById("status");

const API_HOST_PERMISSION = "http://127.0.0.1/*";
const IS_FIREFOX = chrome.runtime.getURL("").startsWith("moz-extension:");

loadSettings();
refreshPermissionUi();
saveButton.addEventListener("click", saveSettings);
testButton.addEventListener("click", testConnection);
grantButton.addEventListener("click", requestHostAccess);

async function hasHostAccess() {
  try {
    return await chrome.permissions.contains({ origins: [API_HOST_PERMISSION] });
  } catch {
    return true;
  }
}

async function refreshPermissionUi() {
  if (!IS_FIREFOX) return;
  const granted = await hasHostAccess();
  permissionWarning.hidden = granted;
  permissionHelp.hidden = granted;
  grantButton.hidden = granted;
}

async function requestHostAccess() {
  // Must be called from this click handler: permissions.request() needs a
  // user gesture and cannot be called from the background page.
  let granted = false;
  try {
    granted = await chrome.permissions.request({ origins: [API_HOST_PERMISSION] });
  } catch {
    granted = false;
  }

  await refreshPermissionUi();
  if (granted) {
    showStatus("Access granted. Click Test connection again.", true);
    return;
  }

  showStatus(
    "Firefox did not grant access. Open about:addons -> Web Clipper for Super Productivity -> Permissions and data, and allow access to 127.0.0.1.",
    false
  );
}

async function loadSettings() {
  const settings = await chrome.storage.local.get(["accessToken"]);
  tokenInput.value = settings.accessToken || "";
}

async function saveSettings() {
  await chrome.storage.local.set({
    accessToken: tokenInput.value.trim()
  });
  showStatus("Settings saved locally.", true);
}

async function testConnection() {
  await saveSettings();
  setBusy(true);
  showStatus("Checking GET /health...", true);
  try {
    const result = await chrome.runtime.sendMessage({ type: "TEST_CONNECTION" });
    if (result.ok) {
      showStatus("Connection successful: GET /health and authenticated GET /projects succeeded.", true);
      return;
    }

    const failedStep = result.step === "health" ? "GET /health" : "authenticated GET /projects";
    showStatus(`${failedStep} failed: ${formatError(result.error)}`, false);
  } catch (error) {
    showStatus(formatError(error), false);
  } finally {
    setBusy(false);
  }
}

function formatError(error) {
  if (error?.code === "UNAUTHORIZED" || error?.status === 401) {
    return "Token missing or wrong; copy it from Settings -> Misc.";
  }
  if (error?.code === "FORBIDDEN") {
    return "The app rejected the request. Super Productivity may have changed its API; check for an extension update.";
  }
  if (error?.code === "HOST_PERMISSION_MISSING") {
    return error.message
      || "Firefox has not granted this extension access to 127.0.0.1. Click Grant access, or enable it in about:addons -> this extension -> Permissions.";
  }
  if (error?.code === "NETWORK_OR_TIMEOUT") {
    return "Super Productivity isn't running, or the local REST API is off (Settings -> Misc).";
  }
  if (error?.code === "UNKNOWN") return error.message || "Something went wrong.";
  if (error?.code && error?.message) return `${error.code}: ${error.message}`;
  return "Super Productivity isn't running, or the local REST API is off (Settings -> Misc).";
}

function showStatus(message, success) {
  statusOutput.textContent = message;
  statusOutput.style.color = success ? "var(--ok)" : "var(--err)";
}

function setBusy(isBusy) {
  testButton.disabled = isBusy;
  saveButton.disabled = isBusy;
  testButton.textContent = isBusy ? "Testing..." : "Test connection";
}
