/* ── YOLOv8s Detector — Renderer Logic ──────────────────────────────────── */

// ── State ─────────────────────────────────────────────────────────────────
let imagePath      = null;
let videoPath      = null;
let activeTab      = "image";
let streaming      = false;
let drawMode       = "box";
let imageHasResult = false;

// Image: store last raw result for client-side re-render on label toggle
let imgLastResult  = null;   // { orig_image, draw_mode, raw_items, detections }

// Video/Webcam: set of label names the user has hidden
let vidHiddenLabels = new Set();
let camHiddenLabels = new Set();
// All labels ever seen (for the tag bar above the output)
let vidSeenLabels   = new Map();  // label -> hex color
let camSeenLabels   = new Map();

// Video state
let videoState   = "idle";
let videoTotal   = 0;
let videoFps     = 30;
let seekDragging = false;

// SVG icons
const ICON_PLAY     = `<polygon points="5 3 19 12 5 21 5 3" stroke-width="2"/>`;
const ICON_PAUSE    = `<rect x="6" y="4" width="4" height="16" rx="1" stroke-width="2"/><rect x="14" y="4" width="4" height="16" rx="1" stroke-width="2"/>`;
const ICON_CONTINUE = `<polygon points="5 3 19 12 5 21 5 3" stroke-width="2"/>`;

// ── Debounce ──────────────────────────────────────────────────────────────
function debounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

// ── Draw mode toggle ──────────────────────────────────────────────────────
function setDrawMode(mode) {
  drawMode = mode;
  document.getElementById("mode-box").classList.toggle("mode-active",  mode === "box");
  document.getElementById("mode-draw").classList.toggle("mode-active", mode === "draw");
  if (streaming) {
    window.electronAPI.sendToPython({ cmd: "set_params", draw_mode: mode });
  } else if (activeTab === "image" && imageHasResult) {
    runImageDetection();
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  activeTab = tab;
  document.querySelectorAll(".tab-btn").forEach((b) =>
    b.classList.toggle("active", b.dataset.tab === tab)
  );
  document.querySelectorAll(".tab-panel").forEach((p) => {
    p.classList.toggle("hidden", !p.id.endsWith(tab));
    p.classList.toggle("flex",   p.id.endsWith(tab));
  });
  if (streaming) stopVideoFull();
}

// ── Python message handler ────────────────────────────────────────────────
window.electronAPI.onPyMessage((msg) => {
  switch (msg.type) {
    case "ready":
      setStatus("ready", "Model ready"); break;

    case "image_result":
      showImageResult(msg); break;

    case "video_started":
      streaming  = true;
      videoState = "playing";
      videoTotal = msg.total_frames || 0;
      videoFps   = msg.fps || 30;
      setVideoBtn("playing");
      vidHiddenLabels = new Set();
      vidSeenLabels   = new Map();
      document.getElementById("vid-label-bar").innerHTML = "";
      const wrap = document.getElementById("vid-seekbar-wrap");
      wrap.classList.remove("hidden"); wrap.classList.add("flex");
      const bar = document.getElementById("vid-seekbar");
      bar.max = videoTotal; bar.value = 0;
      document.getElementById("vid-time-total").textContent = formatTime(videoTotal, videoFps);
      setStatus("busy", "Playing…"); break;

    case "video_paused":
      videoState = "paused"; setVideoBtn("paused"); setStatus("ready", "Paused"); break;

    case "video_resumed":
      videoState = "playing"; setVideoBtn("playing"); setStatus("busy", "Playing…"); break;

    case "video_frame":
      showVideoFrame(msg); break;

    case "webcam_frame":
      showStreamFrame(msg); break;

    case "webcam_started":
      streaming = true;
      camHiddenLabels = new Set();
      camSeenLabels   = new Map();
      document.getElementById("cam-label-bar").innerHTML = "";
      setStatus("busy", "Camera live…"); break;

    case "stream_ended":
      streaming = false; videoState = "idle"; setVideoBtn("idle");
      setStatus("ready", "Video ended"); break;

    case "stopped":
      streaming = false; videoState = "idle"; setVideoBtn("idle"); break;

    case "error":
      setStatus("error", msg.message || "Error");
      console.error("[py error]", msg.message); break;

    case "pong":
      setStatus("ready", "Model ready"); break;
  }
});

setTimeout(() => window.electronAPI.sendToPython({ cmd: "ping" }), 800);

// ── Status ────────────────────────────────────────────────────────────────
function setStatus(state, text) {
  const dot = document.getElementById("status-dot");
  const span = document.getElementById("status-text");
  span.textContent = text;
  dot.className = "w-2 h-2 rounded-full";
  if      (state === "ready") dot.classList.add("bg-green-400");
  else if (state === "busy")  dot.classList.add("bg-yellow-400", "animate-pulse");
  else if (state === "error") dot.classList.add("bg-red-400");
  else                        dot.classList.add("bg-yellow-400", "animate-pulse");
}

// ── Video button ──────────────────────────────────────────────────────────
function setVideoBtn(state) {
  const icon  = document.getElementById("vid-play-icon");
  const label = document.getElementById("vid-play-label");
  const btn   = document.getElementById("vid-play-btn");
  if (state === "playing") {
    icon.innerHTML = ICON_PAUSE; label.textContent = "Pause";
    btn.classList.remove("bg-accent","bg-success"); btn.classList.add("bg-warning");
  } else if (state === "paused") {
    icon.innerHTML = ICON_CONTINUE; label.textContent = "Continue";
    btn.classList.remove("bg-warning","bg-accent"); btn.classList.add("bg-success");
  } else {
    icon.innerHTML = ICON_PLAY; label.textContent = "Play";
    btn.classList.remove("bg-warning","bg-success"); btn.classList.add("bg-accent");
  }
}

function toggleVideoPlayback() {
  if      (videoState === "idle")    startVideo();
  else if (videoState === "playing") window.electronAPI.sendToPython({ cmd: "pause_video" });
  else if (videoState === "paused")  window.electronAPI.sendToPython({ cmd: "resume_video" });
}

// ── Seek ──────────────────────────────────────────────────────────────────
function onSeekStart() { seekDragging = true; }
function onSeekInput(val) {
  document.getElementById("vid-time-cur").textContent = formatTime(parseInt(val), videoFps);
}
function onSeekEnd(val) {
  seekDragging = false;
  window.electronAPI.sendToPython({ cmd: "seek_video", frame: parseInt(val) });
  if (videoState === "paused") window.electronAPI.sendToPython({ cmd: "resume_video" });
}
function formatTime(frames, fps) {
  const s = Math.floor(frames / (fps || 30));
  return `${Math.floor(s/60)}:${String(s%60).padStart(2,"0")}`;
}

// ── Image tab ─────────────────────────────────────────────────────────────
function handleImageDrop(e) {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && /\.(jpe?g|png|bmp|webp|tiff?)$/i.test(f.name)) setImageFile(f.path, f.name);
}
async function browseImage() {
  const r = await window.electronAPI.openFileDialog({
    title: "Select Image",
    filters: [{ name: "Images", extensions: ["jpg","jpeg","png","bmp","webp"] }],
    properties: ["openFile"],
  });
  if (!r.canceled && r.filePaths.length) {
    const fp = r.filePaths[0];
    setImageFile(fp, fp.split(/[\\/]/).pop());
  }
}
function setImageFile(path, name) {
  imagePath = path;
  const fn = document.getElementById("img-filename");
  fn.textContent = "📁 " + name; fn.classList.remove("hidden");
  const dz = document.getElementById("img-dropzone");
  dz.classList.add("border-accent");
  dz.querySelector("p").innerHTML =
    `<span class="text-accent font-medium">${name}</span><br/><span class="text-xs text-muted">Ready to detect</span>`;
}
function runImageDetection() {
  if (!imagePath) { alert("Please select an image first."); return; }
  const conf = parseFloat(document.getElementById("img-conf").value);
  setStatus("busy", "Detecting…");
  showLoadingInResults("img-results");
  showLoadingInDisplay("img-output", "img-placeholder");
  window.electronAPI.sendToPython({ cmd: "detect_image", path: imagePath, conf, iou: 0.45, draw_mode: drawMode });
}

function showImageResult(msg) {
  imageHasResult = true;
  imgLastResult  = msg;
  imgHiddenLabels = new Set();   // reset on every new detection run
  setStatus("ready", `${msg.detections.items.length} objects found`);

  // Show annotated image
  const img = document.getElementById("img-output");
  img.src = "data:image/jpeg;base64," + msg.image;
  img.classList.remove("hidden");
  document.getElementById("img-placeholder").classList.add("hidden");

  // Render results panel with clickable label tags
  renderImageDetections(msg.detections, msg.raw_items, new Set());
}

// ── Image: render results with clickable label tags ───────────────────────
// hiddenLabels is a Set of label strings currently hidden
function renderImageDetections(detections, rawItems, hiddenLabels) {
  const container = document.getElementById("img-results");
  if (!detections || !detections.items.length) {
    container.innerHTML = `<div class="text-xs text-muted text-center mt-8">No objects detected</div>`;
    return;
  }
  const { items, stats } = detections;

  // Unique labels for tag chips
  const uniqueLabels = [...new Set(items.map(i => i.label))];
  const labelColors  = {};
  items.forEach(i => { labelColors[i.label] = i.color; });

  const tagsHtml = uniqueLabels.map(lbl => {
    const hidden = hiddenLabels.has(lbl);
    const col    = labelColors[lbl];
    return `<button
      class="label-tag ${hidden ? "label-tag-off" : ""}"
      style="${hidden ? "" : `border-color:${col};color:${col};background:${col}22`}"
      onclick="toggleImageLabel('${lbl}')"
      data-label="${lbl}">
      <span class="label-tag-dot" style="background:${hidden ? "#555" : col}"></span>
      ${lbl}
    </button>`;
  }).join("");

  const rowsHtml = items.map(item => {
    const pct    = Math.round(item.score * 100);
    const hidden = hiddenLabels.has(item.label);
    return `<div class="det-row ${hidden ? "opacity-30" : ""}">
      <span class="det-index">${item.index}</span>
      <span class="det-label" style="color:${item.color}">${item.label}</span>
      <span class="det-score">${pct}%</span>
      <div class="det-bar-wrap">
        <div class="det-bar" style="width:${pct}%;background:${item.color}"></div>
      </div>
    </div>`;
  }).join("");

  container.innerHTML = `
    <div class="mb-3">
      <div class="text-xs text-muted mb-2 font-semibold uppercase tracking-wider">
        Results — ${items.length} object${items.length !== 1 ? "s" : ""}
      </div>
      <div class="text-xs text-muted mb-1">Click to hide/show:</div>
      <div class="flex flex-wrap gap-1 mb-3" id="img-label-tags">${tagsHtml}</div>
      <div class="border-t border-border pt-2">
        <div class="flex text-xs text-muted mb-1 gap-2">
          <span class="w-5 text-right">#</span>
          <span class="flex-1">Label</span>
          <span class="w-10 text-right">Conf</span>
          <span class="w-12"></span>
        </div>
        ${rowsHtml}
      </div>
    </div>`;
}

// Track which image labels are hidden
let imgHiddenLabels = new Set();

function toggleImageLabel(label) {
  if (imgHiddenLabels.has(label)) imgHiddenLabels.delete(label);
  else imgHiddenLabels.add(label);

  // Re-render the results panel UI
  renderImageDetections(imgLastResult.detections, imgLastResult.raw_items, imgHiddenLabels);

  // Re-draw the image using canvas
  redrawImageWithHidden(imgHiddenLabels);
}

function redrawImageWithHidden(hiddenLabels) {
  if (!imgLastResult) return;
  const { orig_image, draw_mode, raw_items } = imgLastResult;

  const canvas = document.createElement("canvas");
  const baseImg = new Image();
  baseImg.onload = () => {
    canvas.width  = baseImg.naturalWidth;
    canvas.height = baseImg.naturalHeight;
    const ctx = canvas.getContext("2d");
    ctx.drawImage(baseImg, 0, 0);

    if (draw_mode === "draw") {
      // Draw semi-transparent filled polygons
      // First pass: fill overlay at 50% alpha
      raw_items.forEach(item => {
        if (hiddenLabels.has(item.label) || !item.points || !item.points.length) return;
        ctx.save();
        ctx.globalAlpha = 0.5;
        ctx.fillStyle   = item.color;
        ctx.beginPath();
        item.points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        // Outline
        ctx.save();
        ctx.strokeStyle = item.color;
        ctx.lineWidth   = 2;
        ctx.beginPath();
        item.points.forEach(([x, y], i) => i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y));
        ctx.closePath();
        ctx.stroke();
        ctx.restore();
        // Label
        drawLabelOnCanvas(ctx, item, item.points[0]?.[0] ?? 0, item.points[0]?.[1] ?? 0);
      });
    } else {
      // Draw bounding boxes
      raw_items.forEach(item => {
        if (hiddenLabels.has(item.label) || !item.box) return;
        const [x1, y1, x2, y2] = item.box;
        ctx.save();
        ctx.strokeStyle = item.color;
        ctx.lineWidth   = 2;
        ctx.strokeRect(x1, y1, x2 - x1, y2 - y1);
        ctx.restore();
        drawLabelOnCanvas(ctx, item, x1, y1);
      });
    }

    document.getElementById("img-output").src = canvas.toDataURL("image/jpeg", 0.9);
  };
  baseImg.src = "data:image/jpeg;base64," + orig_image;
}

function drawLabelOnCanvas(ctx, item, x, y) {
  const text    = `${item.label} ${(item.score * 100).toFixed(0)}%`;
  const fontSize = Math.max(12, Math.min(16, ctx.canvas.width / 60));
  ctx.font      = `600 ${fontSize}px Inter, sans-serif`;
  const tw      = ctx.measureText(text).width;
  const th      = fontSize;
  const pad     = 4;
  const ly      = Math.max(y - 4, th + pad * 2);
  ctx.save();
  ctx.fillStyle = item.color;
  ctx.fillRect(x, ly - th - pad, tw + pad * 2, th + pad * 2);
  ctx.fillStyle = "#ffffff";
  ctx.fillText(text, x + pad, ly - 2);
  ctx.restore();
}

// Reset hidden labels when a new detection runs
const _origRunImageDetection = runImageDetection;
// (imgHiddenLabels is reset inside showImageResult)

// ── Video tab ─────────────────────────────────────────────────────────────
function handleVideoDrop(e) {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (f && /\.(mp4|avi|mov|mkv|webm)$/i.test(f.name)) setVideoFile(f.path, f.name);
}
async function browseVideo() {
  const r = await window.electronAPI.openFileDialog({
    title: "Select Video",
    filters: [{ name: "Videos", extensions: ["mp4","avi","mov","mkv","webm"] }],
    properties: ["openFile"],
  });
  if (!r.canceled && r.filePaths.length) {
    const fp = r.filePaths[0];
    setVideoFile(fp, fp.split(/[\\/]/).pop());
  }
}
function setVideoFile(path, name) {
  videoPath = path;
  const fn = document.getElementById("vid-filename");
  fn.textContent = "📁 " + name; fn.classList.remove("hidden");
  const dz = document.getElementById("vid-dropzone");
  dz.classList.add("border-accent");
  dz.querySelector("p").innerHTML =
    `<span class="text-accent font-medium">${name}</span><br/><span class="text-xs text-muted">Ready to play</span>`;
}
function startVideo() {
  if (!videoPath) { alert("Please select a video file first."); return; }
  const conf = parseFloat(document.getElementById("vid-conf").value);
  setStatus("busy", "Loading video…");
  window.electronAPI.sendToPython({ cmd: "start_video", path: videoPath, conf, iou: 0.45, draw_mode: drawMode });
}
function stopVideoFull() {
  window.electronAPI.sendToPython({ cmd: "stop" });
  streaming = false; videoState = "idle"; setVideoBtn("idle");
  setStatus("ready", "Stopped");
  const wrap = document.getElementById("vid-seekbar-wrap");
  wrap.classList.add("hidden"); wrap.classList.remove("flex");
}

function showVideoFrame(msg) {
  const img = document.getElementById("vid-output");
  const ph  = document.getElementById("vid-placeholder");
  img.src = "data:image/jpeg;base64," + msg.image;
  img.classList.remove("hidden"); ph.classList.add("hidden");

  if (!seekDragging && msg.frame_pos !== undefined && videoTotal > 0) {
    document.getElementById("vid-seekbar").value = msg.frame_pos;
    document.getElementById("vid-time-cur").textContent = formatTime(msg.frame_pos, videoFps);
  }

  // Update seen labels and tag bar
  updateStreamLabelBar("vid", msg.detections, vidSeenLabels, vidHiddenLabels);
  renderStreamResults("vid-results", msg.detections, vidHiddenLabels);
}

// ── Webcam tab ────────────────────────────────────────────────────────────
function startWebcam() {
  const conf = parseFloat(document.getElementById("cam-conf").value);
  const cam  = parseInt(document.getElementById("cam-index").value, 10);
  setStatus("busy", "Starting camera…");
  window.electronAPI.sendToPython({ cmd: "start_webcam", conf, iou: 0.45, cam, draw_mode: drawMode });
}
function stopStream() {
  window.electronAPI.sendToPython({ cmd: "stop" });
  streaming = false; setStatus("ready", "Stopped");
}
function showStreamFrame(msg) {
  const img = document.getElementById("cam-output");
  const ph  = document.getElementById("cam-placeholder");
  img.src = "data:image/jpeg;base64," + msg.image;
  img.classList.remove("hidden"); ph.classList.add("hidden");

  updateStreamLabelBar("cam", msg.detections, camSeenLabels, camHiddenLabels);
  renderStreamResults("cam-results", msg.detections, camHiddenLabels);
}

// ── Stream label bar (video / webcam) ─────────────────────────────────────
// Updates the persistent tag bar above the output with all ever-seen labels
function updateStreamLabelBar(prefix, detections, seenMap, hiddenSet) {
  if (!detections || !detections.items.length) return;
  let changed = false;
  detections.items.forEach(item => {
    if (!seenMap.has(item.label)) {
      seenMap.set(item.label, item.color);
      changed = true;
    }
  });
  if (!changed) return;  // no new labels, skip re-render

  const bar = document.getElementById(`${prefix}-label-bar`);
  bar.innerHTML = [...seenMap.entries()].map(([lbl, col]) => {
    const hidden = hiddenSet.has(lbl);
    return `<button
      class="label-tag ${hidden ? "label-tag-off" : ""}"
      style="${hidden ? "" : `border-color:${col};color:${col};background:${col}22`}"
      onclick="toggleStreamLabel('${prefix}','${lbl}')"
      data-label="${lbl}">
      <span class="label-tag-dot" style="background:${hidden ? "#555" : col}"></span>
      ${lbl}
    </button>`;
  }).join("");
}

function toggleStreamLabel(prefix, label) {
  const hiddenSet = prefix === "vid" ? vidHiddenLabels : camHiddenLabels;
  const seenMap   = prefix === "vid" ? vidSeenLabels   : camSeenLabels;

  if (hiddenSet.has(label)) hiddenSet.delete(label);
  else hiddenSet.add(label);

  // Re-render the tag bar immediately
  const bar = document.getElementById(`${prefix}-label-bar`);
  bar.innerHTML = [...seenMap.entries()].map(([lbl, col]) => {
    const hidden = hiddenSet.has(lbl);
    return `<button
      class="label-tag ${hidden ? "label-tag-off" : ""}"
      style="${hidden ? "" : `border-color:${col};color:${col};background:${col}22`}"
      onclick="toggleStreamLabel('${prefix}','${lbl}')"
      data-label="${lbl}">
      <span class="label-tag-dot" style="background:${hidden ? "#555" : col}"></span>
      ${lbl}
    </button>`;
  }).join("");

  // Tell backend to skip drawing this label from next frame
  window.electronAPI.sendToPython({
    cmd: "set_params",
    hidden_labels: [...hiddenSet],
  });
}

// ── Stream results panel (live, no re-render on toggle — backend handles it) ─
function renderStreamResults(containerId, detections, hiddenSet) {
  const container = document.getElementById(containerId);
  if (!detections || !detections.items.length) {
    container.innerHTML = `<div class="text-xs text-muted text-center mt-8">No objects detected</div>`;
    return;
  }
  const { items, stats } = detections;
  const statsHtml = stats.map(s =>
    `<span class="stat-chip">${s.label} <strong>${s.count}</strong></span>`
  ).join(" ");
  const rowsHtml = items.map(item => {
    const pct    = Math.round(item.score * 100);
    const hidden = hiddenSet.has(item.label);
    return `<div class="det-row ${hidden ? "opacity-30" : ""}">
      <span class="det-index">${item.index}</span>
      <span class="det-label" style="color:${item.color}">${item.label}</span>
      <span class="det-score">${pct}%</span>
      <div class="det-bar-wrap">
        <div class="det-bar" style="width:${pct}%;background:${item.color}"></div>
      </div>
    </div>`;
  }).join("");
  container.innerHTML = `
    <div class="mb-3">
      <div class="text-xs text-muted mb-1 font-semibold uppercase tracking-wider">
        Live — ${items.length} object${items.length !== 1 ? "s" : ""}
      </div>
      <div class="flex flex-wrap gap-1 mb-3">${statsHtml}</div>
      <div class="border-t border-border pt-2">
        <div class="flex text-xs text-muted mb-1 gap-2">
          <span class="w-5 text-right">#</span>
          <span class="flex-1">Label</span>
          <span class="w-10 text-right">Conf</span>
          <span class="w-12"></span>
        </div>
        ${rowsHtml}
      </div>
    </div>`;
}

// ── Loading helpers ───────────────────────────────────────────────────────
function showLoadingInResults(containerId) {
  document.getElementById(containerId).innerHTML = `
    <div class="flex flex-col items-center justify-center mt-12 gap-3">
      <div class="spinner"></div>
      <p class="text-xs text-muted">Running detection…</p>
    </div>`;
}
function showLoadingInDisplay(imgId, phId) {
  document.getElementById(imgId).classList.add("hidden");
  const ph = document.getElementById(phId);
  ph.classList.remove("hidden");
  ph.innerHTML = `<div class="flex flex-col items-center gap-3">
    <div class="spinner"></div>
    <p class="text-sm text-muted">Processing…</p>
  </div>`;
}

// Reset image hidden labels on new detection
const _origShowImageResult = showImageResult;
// (imgHiddenLabels reset happens at top of showImageResult — already handled above)

// ── Drag-over feedback ────────────────────────────────────────────────────
["img-dropzone", "vid-dropzone"].forEach((id) => {
  const el = document.getElementById(id);
  if (!el) return;
  el.addEventListener("dragenter", () => el.classList.add("drag-over"));
  el.addEventListener("dragleave", () => el.classList.remove("drag-over"));
  el.addEventListener("drop",      () => el.classList.remove("drag-over"));
});

// ── Live conf slider wiring ───────────────────────────────────────────────
const imgConfRerun = debounce(() => {
  if (imageHasResult && imagePath) runImageDetection();
}, 300);
document.getElementById("img-conf").addEventListener("input", (e) => {
  document.getElementById("img-conf-val").textContent = parseFloat(e.target.value).toFixed(2);
  imgConfRerun();
});

const vidConfUpdate = debounce((val) => {
  if (streaming && activeTab === "video")
    window.electronAPI.sendToPython({ cmd: "set_params", conf: parseFloat(val) });
}, 200);
document.getElementById("vid-conf").addEventListener("input", (e) => {
  document.getElementById("vid-conf-val").textContent = parseFloat(e.target.value).toFixed(2);
  vidConfUpdate(e.target.value);
});

const camConfUpdate = debounce((val) => {
  if (streaming && activeTab === "webcam")
    window.electronAPI.sendToPython({ cmd: "set_params", conf: parseFloat(val) });
}, 200);
document.getElementById("cam-conf").addEventListener("input", (e) => {
  document.getElementById("cam-conf-val").textContent = parseFloat(e.target.value).toFixed(2);
  camConfUpdate(e.target.value);
});
