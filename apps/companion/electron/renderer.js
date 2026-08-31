// CodeOn Companion — Renderer process

let syncing = false;

const cfHandle = document.getElementById("cfHandle");
const lcHandle = document.getElementById("lcHandle");
const codeonUrl = document.getElementById("codeonUrl");
const syncBtn = document.getElementById("syncBtn");
const syncBtnText = document.getElementById("syncBtnText");
const statusBox = document.getElementById("statusBox");
const connDot = document.getElementById("connDot");
const connText = document.getElementById("connText");
const cfLoginBtn = document.getElementById("cfLoginBtn");
const lcLoginBtn = document.getElementById("lcLoginBtn");

// Load saved settings
(async () => {
  const settings = await window.codeon.getSettings();
  cfHandle.value = settings.cfHandle || "";
  lcHandle.value = settings.lcHandle || "";
  codeonUrl.value = settings.codeonUrl || "http://localhost:3000";
  await checkConnection();
})();

// Save settings on change
function saveSettings() {
  window.codeon.saveSettings({
    cfHandle: cfHandle.value.trim(),
    lcHandle: lcHandle.value.trim(),
    codeonUrl: codeonUrl.value.trim() || "http://localhost:3000",
  });
}
cfHandle.addEventListener("change", saveSettings);
lcHandle.addEventListener("change", saveSettings);
codeonUrl.addEventListener("change", () => { saveSettings(); checkConnection(); });

// Status listener
window.codeon.onStatus((msg) => {
  addStatus(msg, "info");
});

function addStatus(msg, type = "") {
  const line = document.createElement("div");
  line.className = `status-line ${type}`;
  line.textContent = msg;
  statusBox.appendChild(line);
  statusBox.scrollTop = statusBox.scrollHeight;
}

async function checkConnection() {
  const url = codeonUrl.value.trim() || "http://localhost:3000";
  connText.textContent = "Checking...";
  try {
    const result = await window.codeon.checkConnection({ codeonUrl: url });
    if (result.connected) {
      connDot.className = "dot connected";
      connText.textContent = `Connected to ${url}`;
      syncBtn.disabled = false;
    } else {
      connDot.className = "dot disconnected";
      connText.textContent = `Cannot reach CodeOn at ${url}`;
      syncBtn.disabled = true;
    }
  } catch {
    connDot.className = "dot disconnected";
    connText.textContent = `Cannot reach CodeOn at ${url}`;
    syncBtn.disabled = true;
  }
}

// Login buttons
cfLoginBtn.addEventListener("click", async () => {
  cfLoginBtn.textContent = "Opening...";
  cfLoginBtn.disabled = true;
  const result = await window.codeon.login({ platform: "codeforces" });
  cfLoginBtn.textContent = "Login";
  cfLoginBtn.disabled = false;
  if (result.success) {
    addStatus("Chrome opened. Log into Codeforces, then close the browser.", "info");
  } else {
    addStatus(`Login failed: ${result.error}`, "error");
  }
});

lcLoginBtn.addEventListener("click", async () => {
  lcLoginBtn.textContent = "Opening...";
  lcLoginBtn.disabled = true;
  const result = await window.codeon.login({ platform: "leetcode" });
  lcLoginBtn.textContent = "Login";
  lcLoginBtn.disabled = false;
  if (result.success) {
    addStatus("Chrome opened. Log into LeetCode, then close the browser.", "info");
  } else {
    addStatus(`Login failed: ${result.error}`, "error");
  }
});

// Sync button
syncBtn.addEventListener("click", async () => {
  if (syncing) return;
  if (!cfHandle.value.trim() && !lcHandle.value.trim()) {
    addStatus("Please enter at least one handle.", "error");
    return;
  }

  syncing = true;
  syncBtn.disabled = true;
  syncBtnText.innerHTML = '<span class="spinner"></span> Syncing...';
  addStatus("Starting sync...", "info");

  try {
    const result = await window.codeon.sync({
      cfHandle: cfHandle.value.trim(),
      lcHandle: lcHandle.value.trim(),
      codeonUrl: codeonUrl.value.trim() || "http://localhost:3000",
    });

    if (result.status === "done") {
      addStatus(`Sync complete! Uploaded ${result.total} solution(s).`, "success");
    } else {
      addStatus("Sync completed with errors.", "error");
    }

    if (result.errors && result.errors.length > 0) {
      result.errors.forEach(err => addStatus(`  ${err}`, "error"));
    }

    if (result.cf) addStatus(`Codeforces: ${result.cf} solutions uploaded`, "success");
  } catch (e) {
    addStatus(`Sync failed: ${e.message}`, "error");
  } finally {
    syncing = false;
    syncBtn.disabled = false;
    syncBtnText.textContent = "Sync Now";
  }
});
