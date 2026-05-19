/* ── Setup window logic ──────────────────────────────────────────────────── */

let selectedPython = null;  // { exe, version, hasUltralytics }

// ── On load: show config path + scan ─────────────────────────────────────
window.addEventListener("DOMContentLoaded", async () => {
  // Show where config will be saved
  const cfgPath = await window.electronAPI.getConfigPath();
  document.getElementById("config-path").textContent = cfgPath;

  // Scan for Python installs
  const pythons = await window.electronAPI.detectPythons();

  document.getElementById("scanning").classList.add("hidden");

  if (!pythons || pythons.length === 0) {
    document.getElementById("no-results").classList.remove("hidden");
    return;
  }

  renderPythonList(pythons);
});

// ── Render the list of found Pythons ──────────────────────────────────────
function renderPythonList(pythons) {
  const list = document.getElementById("py-list");
  list.classList.remove("hidden");
  list.innerHTML = "";

  // Sort: ones with ultralytics first
  pythons.sort((a, b) => b.hasUltralytics - a.hasUltralytics);

  pythons.forEach((py) => {
    const row = document.createElement("div");
    row.className = "py-row flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer";
    row.dataset.exe = py.exe;

    const badge = py.hasUltralytics
      ? `<span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30 shrink-0">✓ ultralytics</span>`
      : `<span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 shrink-0">no ultralytics</span>`;

    row.innerHTML = `
      <div class="w-8 h-8 rounded-lg bg-card flex items-center justify-center shrink-0">
        <svg class="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
            d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
        </svg>
      </div>
      <div class="flex-1 min-w-0">
        <div class="text-sm font-semibold text-white">${py.version}</div>
        <div class="text-xs text-muted font-mono truncate">${py.exe}</div>
      </div>
      ${badge}
    `;

    row.addEventListener("click", () => selectPython(py, row));
    list.appendChild(row);

    // Auto-select first one that has ultralytics
    if (py.hasUltralytics && !selectedPython) {
      selectPython(py, row);
    }
  });
}

// ── Select a Python entry ─────────────────────────────────────────────────
function selectPython(py, rowEl) {
  selectedPython = py;

  // Update row highlights
  document.querySelectorAll(".py-row").forEach(r => r.classList.remove("selected"));
  if (rowEl) rowEl.classList.add("selected");

  // Show selected path
  document.getElementById("selected-wrap").classList.remove("hidden");
  document.getElementById("selected-path").textContent = py.exe;

  // Enable confirm button
  document.getElementById("confirm-btn").disabled = false;
}

// ── Browse for Python manually ────────────────────────────────────────────
async function browseForPython() {
  const py = await window.electronAPI.browsePython();
  if (!py) return;

  selectedPython = py;

  // Add it to the list (or just show it as selected)
  const list = document.getElementById("py-list");
  list.classList.remove("hidden");
  document.getElementById("no-results").classList.add("hidden");

  // Check if already in list
  const existing = list.querySelector(`[data-exe="${CSS.escape(py.exe)}"]`);
  if (existing) {
    selectPython(py, existing);
    return;
  }

  // Add new row at top
  const row = document.createElement("div");
  row.className = "py-row flex items-center gap-3 p-3 rounded-lg border border-border cursor-pointer";
  row.dataset.exe = py.exe;

  const badge = py.hasUltralytics
    ? `<span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-green-500/15 text-green-400 border border-green-500/30 shrink-0">✓ ultralytics</span>`
    : `<span class="text-xs font-semibold px-2 py-0.5 rounded-full bg-yellow-500/10 text-yellow-500 border border-yellow-500/20 shrink-0">no ultralytics</span>`;

  row.innerHTML = `
    <div class="w-8 h-8 rounded-lg bg-card flex items-center justify-center shrink-0">
      <svg class="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
          d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4"/>
      </svg>
    </div>
    <div class="flex-1 min-w-0">
      <div class="text-sm font-semibold text-white">${py.version}</div>
      <div class="text-xs text-muted font-mono truncate">${py.exe}</div>
    </div>
    ${badge}
  `;

  row.addEventListener("click", () => selectPython(py, row));
  list.insertBefore(row, list.firstChild);
  selectPython(py, row);
}

// ── Confirm and save ──────────────────────────────────────────────────────
async function confirmSelection() {
  if (!selectedPython) return;

  const btn = document.getElementById("confirm-btn");
  btn.disabled = true;
  btn.textContent = "Saving…";

  await window.electronAPI.saveConfig({
    pythonExe:        selectedPython.exe,
    pythonVersion:    selectedPython.version,
    hasUltralytics:   selectedPython.hasUltralytics,
    configuredAt:     new Date().toISOString(),
  });

  btn.textContent = "Launching…";
  window.electronAPI.setupComplete();
}
