// ==== CONFIG ====
const CHANNEL_ID = "UCwkVDkOudIxhYMG61Jv8Tww";
const TWITTER_USERNAME = "FeileacanCu";

// ==== UTILITIES ====

// Info button things
const infoBtn = document.getElementById('infoBtn');
const infoPanel = document.getElementById('infoPanel');
const closeInfo = document.getElementById('closeInfo');

// Open
if (infoBtn && infoPanel) {
  infoBtn.addEventListener('click', () => {
    infoPanel.classList.add('open');
  });
}

// Close via button
if (closeInfo && infoPanel) {
  closeInfo.addEventListener('click', () => {
    infoPanel.classList.remove('open');
  });
}

// Close by clicking left edge
if (infoPanel) {
  infoPanel.addEventListener('click', (e) => {
    const rect = infoPanel.getBoundingClientRect();
    if (e.clientX < rect.left + 30) {
      infoPanel.classList.remove('open');
    }
  });
}

// ==== MULTI-KEY API ROTATION ====
const API_KEYS = [
  "AIzaSyD4P5R5ESGIeMbBsWFC37OBM6t_MKMJXQA",
  "AIzaSyDpEVMya4rDw9-9_xYDukQ4PU6O9L4cSyM",
  "AIzaSyAM6m4JaArIczVC355uyQcLcnOJqmBYq80",
  "AIzaSyAEhDnhnPUaxd70PIviv0-8pnlNwe44XQ4",
  "AIzaSyCXs7M8F3974ERREsTh_M_5LtCYfxLe8uw"
];

let API_KEY_INDEX = 0;
let API_KEY = API_KEYS[API_KEY_INDEX]; // global active key

// Try the current key. If it fails, rotate and try again.
async function ytFetch(url) {
  for (let i = 0; i < API_KEYS.length; i++) {

    API_KEY = API_KEYS[API_KEY_INDEX];

    // Convert URL or string to real request URL
    let tryUrl;
    if (typeof url === "string") {
      tryUrl = url.includes("key=")
        ? url.replace(/key=[^&]+/, "key=" + API_KEY)
        : url + (url.includes("?") ? "&" : "?") + "key=" + API_KEY;
    } else if (url instanceof URL) {
      url.searchParams.set("key", API_KEY);
      tryUrl = url.toString();
    } else {
      throw new Error("Invalid URL passed to ytFetch");
    }

    try {
      const res = await fetch(tryUrl);
      const text = await res.text();

      // Try JSON first. If it fails → return plain text
      try {
        const json = JSON.parse(text);

        // Check quota error inside JSON
        if (json.error?.errors?.[0]?.reason === "quotaExceeded" ||
            json.error?.errors?.[0]?.reason === "dailyLimitExceeded") {
          throw new Error("quota");
        }

        return json;       // Return parsed JSON
      } catch {
        return text;       // CSV / plain text
      }

    } catch (err) {
      console.warn(`API key ${API_KEY} failed (${err.message}). Rotating…`);

      API_KEY_INDEX = (API_KEY_INDEX + 1) % API_KEYS.length;
      API_KEY = API_KEYS[API_KEY_INDEX];
    }
  }

  throw new Error("All API keys exhausted");
}


// ==== PAGE TYPE DETECTION ====
if (document.body.classList.contains("collab-page")) {
  window.IS_COLLAB_PAGE = true;
  window.collapseStage = 0;   // 🔥 Always forced to expanded
} else {
  window.IS_COLLAB_PAGE = false;
}

// ==== CONDITIONAL GLOBAL STREAM DATA ====
// Uses smart caching with playlist itemCount check
window.allStreams = [];

window.fetchAllStreams = async function() {
    if (window.IS_COLLAB_PAGE) {
        console.log("Collab page detected — skipping fetch");
        return [];
    }

  // --- Read cache ---
  const cachedStreams = JSON.parse(localStorage.getItem("allStreams") || "[]");
  const cachedLatestId = cachedStreams[0]?.id || null;

  if (cachedStreams.length > 0) {
      const playlistId = await getChannelDetails();
      if (!playlistId) return [];

      // --- Fetch JUST the first upload (super low quota) ---
      const latestUrl =
          `https://www.googleapis.com/youtube/v3/playlistItems?` +
          `part=contentDetails&playlistId=${playlistId}&maxResults=1&key=${API_KEY}`;

      const latestJson = await ytFetch(latestUrl);

      const liveLatestId = latestJson?.items?.[0]?.contentDetails?.videoId;

      console.log("Cached latest stream:", cachedLatestId);
      console.log("Live latest upload:", liveLatestId);

      if (cachedLatestId === liveLatestId) {
          console.log("✔ Cache is fresh — using cached streams");
          window.allStreams = cachedStreams;
          return cachedStreams;
      }

      console.log("⚠ New upload detected — refreshing stream list…");
  }


    // --- Fetch full data  ---
    try {
        const playlistId = await getChannelDetails();
        if (!playlistId) return [];

        const tagMap = loadStreamTags();
        const fetched = await getVideosFromPlaylist(playlistId);

        const streams = fetched.map(s => {
            const tags = tagMap[s.id] || {};
            const zatsuStart = tags.zatsuStartMinutes || 0;
            const total = s.durationMinutes || 0;

            const d = new Date(s.date);
            const options = { month: "long", day: "numeric" };
            const formattedDate = d.toLocaleDateString("en-GB", options) + " '" + String(d.getFullYear()).slice(-2);

            return {
                ...s,
                tags,
                zatsuStartMinutes: zatsuStart,
                zatsuDuration: Math.max(0, total - zatsuStart),
                gameDuration: Math.max(0, zatsuStart),
                formattedDate,
            };
        });

        // --- Store updated cache ---
        window.allStreams = streams;
        localStorage.setItem("allStreams", JSON.stringify(streams));
        localStorage.setItem("allStreams_count", streams.length);

        console.log("✔ Updated cache with", streams.length, "streams");

        return streams;
    } catch (err) {
        console.error("[fetchAllStreams] Error fetching videos:", err);
        return cachedStreams; // fallback if possible
    }
};


let sortOrder = "newest"; // 🌍 GLOBAL sort order

// Parse YouTube durations into minutes
function parseDurationToMinutes(iso) {
  if (!iso) return 0;
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const h = parseInt(match?.[1] || 0);
  const m = parseInt(match?.[2] || 0);
  const s = parseInt(match?.[3] || 0);
  return h * 60 + m + s / 60;
}

// Parse zatsu_start "H:MM:SS" or "MM:SS" into minutes
function parseZatsuToMinutes(value) {
  if (!value) return 0;
  const parts = value.split(":").map(n => parseFloat(n));
  if (parts.length === 3) {
    const [h, m, s] = parts;
    return h * 60 + m + s / 60;
  } else if (parts.length === 2) {
    const [m, s] = parts;
    return m + s / 60;
  } else if (parts.length === 1 && !isNaN(parts[0])) {
    return parts[0];
  }
  return 0;
}

// Format minutes into "H:MM" or just minutes
function formatMinutesShort(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  return h > 0 ? `${h}:${m.toString().padStart(2, "0")}` : `${m}`;
}

// Format minutes into human-readable "Xh Ym"
function formatMinutesToHM(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

// Escape HTML
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

// ==== YOUTUBE DATA ====

// Fetch channel snippet and uploads playlist ID
async function getChannelDetails() {
  const url = `https://www.googleapis.com/youtube/v3/channels?part=snippet,contentDetails&id=${CHANNEL_ID}&key=${API_KEY}`;
  const data = await ytFetch(url);
  if (!data.items?.length) return null;

  const channel = data.items[0].snippet;

  const titleEl = document.getElementById("channel-title");
  if (titleEl) titleEl.textContent = channel.title;

  const thumbEl = document.getElementById("channel-thumbnail");
  if (thumbEl) thumbEl.src = channel.thumbnails?.high?.url || "";

  const ytLinkEl = document.getElementById("youtube-link");
  if (ytLinkEl) ytLinkEl.href = `https://www.youtube.com/channel/${CHANNEL_ID}/streams`;

  return data.items[0].contentDetails.relatedPlaylists.uploads;
}

// Fetch all videos from a playlist, with full details
async function getVideosFromPlaylist(playlistId) {
  let videos = [];
  let pageToken = "";

  // Fetch all playlist items
  do {
    const url = new URL("https://www.googleapis.com/youtube/v3/playlistItems");
    url.search = new URLSearchParams({
      part: "snippet",
      maxResults: "50",
      playlistId,
      pageToken,
      key: API_KEY,
    }).toString();

    const data = await ytFetch(url);
    if (!data.items) break;

    videos.push(...data.items);
    pageToken = data.nextPageToken || "";
    await new Promise(r => setTimeout(r, 150)); // safety
  } while (pageToken);

  // Fetch video details in chunks of 50
  const videoIds = videos.map(v => v.snippet.resourceId.videoId);
  const details = [];

  for (let i = 0; i < videoIds.length; i += 50) {
    const chunk = videoIds.slice(i, i + 50).join(",");
    const detailsUrl = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,liveStreamingDetails,snippet&id=${chunk}&key=${API_KEY}`;
    const detailsRes = await fetch(detailsUrl);
    const detailsData = await detailsRes.json();
    details.push(...(detailsData.items || []));
    await new Promise(r => setTimeout(r, 150));
  }

  return details
    .filter(v => v.snippet.liveBroadcastContent === "none" && v.liveStreamingDetails)
    .map(v => ({
      id: v.id,
      title: v.snippet.title,
      date: v.snippet.publishedAt,
      duration: v.contentDetails.duration,
      durationMinutes: parseDurationToMinutes(v.contentDetails.duration),
      thumbnail: v.snippet.thumbnails?.high?.url || "",
    }));
}

// ==== TAG HELPERS ====

// Load tag data from embedded CSV
function loadStreamTags() {
  const csvDataEl = document.getElementById("meta-csv");
  if (!csvDataEl) return {}; // safe for suggest.html

  const csvData = csvDataEl.textContent.trim();
  const lines = csvData.split("\n").filter(line => line.trim());
  const headers = lines[0].split(",").map(h => h.trim());
  const rows = lines.slice(1);

  const tagMap = {};

  for (const row of rows) {
    const cols = row.split(",");
    const record = {};
    headers.forEach((h, i) => record[h] = (cols[i] || "").trim());

    const id = extractVideoId(record.stream_link);
    if (!id) continue;

    const zatsuStartMinutes = parseZatsuToMinutes(record.zatsu_start);
    tagMap[id] = { ...record, zatsuStartMinutes };
  }

  return tagMap;
}

// validate 11-char link ID
function extractVideoId(value) {
  if (!value) return null;
  const id = value.trim();
  return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
}


// ==== TAG BUTTONS ====

let tagStates = {}; // three-state per tag

function createTagButtons(tagNames) {
const container = document.querySelector(".tag-section");
if (!container) return;

tagStates = {};

// Keep collapse button
const collapseBtn = document.getElementById("collapseTagsBtn");
container.innerHTML = ""; // wipes everything
if (collapseBtn) container.appendChild(collapseBtn); // restore it

tagNames.forEach(tag => {
  tagStates[tag] = "none";
  const btn = document.createElement("button");
  btn.className = "tag-btn";
  btn.innerHTML = `<span>${tag}</span>`;
  btn.addEventListener("click", () => cycleTagState(tag, btn));
  updateTagButtonStyle(btn, "none");

  container.appendChild(btn);
});
}

function cycleTagState(tag, btn) {
  const states = ["none", "include", "exclude"];
  const next = states[(states.indexOf(tagStates[tag]) + 1) % states.length];
  setTagState(tag, btn, next);
  filterAndSortStreams();
}

function setTagState(tag, btn, state) {
  tagStates[tag] = state;
  updateTagButtonStyle(btn, state);
}

function updateTagButtonStyle(btn, state) {
  btn.classList.remove("include", "exclude");
  if (state === "include") btn.classList.add("include");
  if (state === "exclude") btn.classList.add("exclude");
}

// ==== SLIDER LOGIC ====

function setupDualSlider(options) {
  const { minId, maxId, fillId, minLabelId, maxLabelId, containerId, realMax, onChange } = options;

  const minInput = document.getElementById(minId);
  const maxInput = document.getElementById(maxId);
  const rangeFill = document.getElementById(fillId);
  const minLabelEl = document.getElementById(minLabelId);
  const maxLabelEl = document.getElementById(maxLabelId);

  if (!minInput || !maxInput) return;

  const sliderMin = 0;
  const sliderMax = Math.max(1, Math.round(realMax));
  const STEP = 1;

  [minInput, maxInput].forEach(input => {
    input.min = sliderMin;
    input.max = sliderMax;
    input.step = STEP;
  });

  minInput.value = sliderMin;
  maxInput.value = sliderMax;

function updateFill(minV, maxV) {
  if (!rangeFill) return;

  const sliderMinVal = parseInt(minInput.min);
  const sliderMaxVal = parseInt(maxInput.max);

  const percentMin = ((minV - sliderMinVal) / (sliderMaxVal - sliderMinVal)) * 100;
  const percentMax = ((maxV - sliderMinVal) / (sliderMaxVal - sliderMinVal)) * 100;

  rangeFill.style.left = percentMin + "%";
  rangeFill.style.width = (percentMax - percentMin) + "%";
}

  const handleInput = () => {
    let minVal = parseInt(minInput.value);
    let maxVal = parseInt(maxInput.value);

    if (minVal > maxVal - STEP) minVal = maxVal - STEP;
    if (maxVal < minVal + STEP) maxVal = minVal + STEP;

    minInput.value = minVal;
    maxInput.value = maxVal;
    updateFill(minVal, maxVal);

    if (minLabelEl) minLabelEl.textContent = formatMinutesShort(minVal);
    if (maxLabelEl) maxLabelEl.textContent = formatMinutesShort(maxVal);

    if (onChange) onChange(minVal, maxVal);
  };

  minInput.addEventListener("input", handleInput);
  maxInput.addEventListener("input", handleInput);
  window.addEventListener("resize", () => updateFill(parseInt(minInput.value), parseInt(maxInput.value)));

  // initial call to set labels/fill
  handleInput();
}

// ==== STREAM DISPLAY & FILTERING ====

let allStreams = [];
let currentDurationType = "full";

function displayStreams(streams) {
  const grid = document.getElementById("video-grid");
  if (!grid) return;

  if (!streams.length) {
    grid.innerHTML = "<p style='text-align:center;color:#aaa;'>No streams found.</p>";
    return;
  }

  grid.innerHTML = streams.map(s => {
    const isTagged = s.tags && Object.keys(s.tags).some(k => k && k !== "stream_link" && k !== "zatsu_start");
    const untaggedLabel = !isTagged ? `<span class="untagged-label">Untagged</span>` : "";

    // Use currentDurationType for displayed duration
    const displayedDuration = s.durationMinutes || 0;

    return `
      <div class="video-card">
        <a href="https://youtu.be/${s.id}" target="_blank" class="thumb-link">
          <img src="${s.thumbnail}" alt="${escapeHtml(s.title)}" loading="lazy" />
        </a>
        <div class="video-info">
          <h3>${escapeHtml(s.title)}</h3>
          <div class="video-meta">
            <p class="video-date">${s.formattedDate}</p>
            ${untaggedLabel}
            <p class="video-duration">${formatMinutesToHM(displayedDuration)}</p>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function streamHasTagValue(stream, tagName) {
  if (!stream.tags) return false;
  const val = stream.tags[tagName];
  if (!val) return false;
  const t = String(val).trim();
  if (t === "") return false;
  if (!Number.isNaN(Number(t))) return Number(t) > 0;
  return true;
}

function durationForStreamByMode(s) {
  if (currentDurationType === "game") return s.gameDuration || 0;
  if (currentDurationType === "zatsu") return s.zatsuDuration || 0;
  return s.durationMinutes || 0;
}

// Filter streams based on search, duration, tags
function filterAndSortStreams() {
  if (!allStreams?.length) return;

  // === COLLAB PAGE FIX: never hide tag buttons ===
  if (IS_COLLAB_PAGE) {
    document.querySelectorAll("#tag-filters button").forEach(b => b.style.display = "");
  }

  const searchTerm = (document.getElementById("searchInput")?.value || "").toLowerCase();
  const minVal = parseInt(document.getElementById("durationMin")?.value || 0);
  const maxVal = parseInt(document.getElementById("durationMax")?.value || 9999);

  const includeTags = Object.entries(tagStates).filter(([_, v]) => v === "include").map(([k]) => k);
  const excludeTags = Object.entries(tagStates).filter(([_, v]) => v === "exclude").map(([k]) => k);

  const filtered = allStreams.filter(s => {
    const duration = durationForStreamByMode(s);
    const inDurationRange = duration >= minVal && duration <= maxVal;
    const matchesText = s.title.toLowerCase().includes(searchTerm) ||
                        s.formattedDate.toLowerCase().includes(searchTerm);
    const hasIncluded = includeTags.every(t => streamHasTagValue(s, t));
    const hasExcluded = excludeTags.some(t => streamHasTagValue(s, t));

    return inDurationRange && matchesText && hasIncluded && !hasExcluded;
  });

  filtered.sort((a, b) => {
    switch (sortOrder) {
      case "oldest": return new Date(a.date) - new Date(b.date);
      case "shortest": return durationForStreamByMode(a) - durationForStreamByMode(b);
      case "longest": return durationForStreamByMode(b) - durationForStreamByMode(a);
      default: return new Date(b.date) - new Date(a.date);
    }
  });

  // Update stream count display
  const countEl = document.getElementById("streamCount");
  if (countEl) {
    countEl.textContent = `Showing ${filtered.length} stream${filtered.length === 1 ? "" : "s"}`;
  }

  displayStreams(filtered);
}

// ==== MAIN INITIALIZATION ====

async function initMainPage() {
  try {
    const playlistId = await getChannelDetails();
    if (!playlistId) {
      const vg = document.getElementById("video-grid");
      if (vg) vg.innerHTML = "<p style='text-align:center;color:#aaa;'>Channel not found.</p>";
      return;
    }

    const tagMap = loadStreamTags();
    const fetched = await getVideosFromPlaylist(playlistId);

    const sample = Object.keys(Object.values(tagMap)[0] || {});
    const tagNames = sample.filter(t => !["stream_link","stream_title", "zatsu_start", "zatsuStartMinutes"].includes(t));
    // Sort alphabetically
    tagNames.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
    createTagButtons(tagNames);

// ------------------------------

    allStreams = fetched.map(s => {
      const tags = tagMap[s.id] || {};
      const zatsuStart = tags.zatsuStartMinutes || 0;
      const total = s.durationMinutes || 0;

      const d = new Date(s.date);
      const options = { month: 'long', day: 'numeric' };
      const formattedDate = d.toLocaleDateString('en-GB', options) + " '" + String(d.getFullYear()).slice(-2);

      return {
        ...s,
        tags,
        zatsuStartMinutes: zatsuStart,
        zatsuDuration: Math.max(0, total - zatsuStart),
        gameDuration: Math.max(0, zatsuStart),
        formattedDate, 
      };
    });


    // Slider setup: compute the default max for "full" mode
    let currentMaxVal = Math.max(30, Math.ceil(Math.max(...allStreams.map(s => s.durationMinutes || 0))));

    setupDualSlider({
      minId: "durationMin",
      maxId: "durationMax",
      fillId: "durationRangeFill",
      minLabelId: "durationMinLabel",
      maxLabelId: "durationMaxLabel",
      containerId: "durationSliderContainer",
      realMax: currentMaxVal,
      onChange: (min, max) => {
        currentMinVal = min;
        currentMaxVal = max;
        filterAndSortStreams();
      }
    });

    // Wire search/sort
    document.getElementById("searchInput")?.addEventListener("input", filterAndSortStreams);
    document.getElementById("sortOrder")?.addEventListener("change", filterAndSortStreams);

    const sortToggle = document.getElementById("sortToggle");

    if (sortToggle) {
      sortToggle.addEventListener("click", () => {
        sortOrder = (sortOrder === "newest") ? "oldest" : "newest";
        sortToggle.textContent = sortOrder === "newest"
          ? "Newest First ▾"
          : "Oldest First ▴";

        filterAndSortStreams();
      });
}


    // === Duration Mode Buttons: update mode + recalc slider bounds & visuals ===
    const modeButtons = document.querySelectorAll(".mode-btn");
    modeButtons.forEach(btn => {
      btn.addEventListener("click", () => {
        modeButtons.forEach(b => b.classList.remove("active"));
        btn.classList.add("active");

        // Set global mode
        currentDurationType = btn.dataset.mode || "full";

        // Recompute the max for this mode
        const maxForMode = Math.max(1, Math.ceil(Math.max(...allStreams.map(s => {
          if (currentDurationType === "game") return s.gameDuration || 0;
          if (currentDurationType === "zatsu") return s.zatsuDuration || 0;
          return s.durationMinutes || 0;
        }))));

        // Update slider bounds safely (only if elements exist)
        const minEl = document.getElementById("durationMin");
        const maxEl = document.getElementById("durationMax");
        const fill = document.getElementById("durationRangeFill");
        const minLbl = document.getElementById("durationMinLabel");
        const maxLbl = document.getElementById("durationMaxLabel");

        if (minEl && maxEl) {
          // Update max attributes
          minEl.max = maxForMode;
          maxEl.max = maxForMode;

          // Clamp values if necessary
          if (parseInt(maxEl.value) > maxForMode) maxEl.value = maxForMode;
          if (parseInt(minEl.value) >= parseInt(maxEl.value)) {
            minEl.value = Math.max(0, parseInt(maxEl.value) - 1);
          }

          // Recalculate fill & labels
          const sliderMin = parseFloat(minEl.min);
          const sliderMax = parseFloat(maxEl.max);
          const range = Math.max(1, sliderMax - sliderMin);
          const newMin = parseInt(minEl.value);
          const newMax = parseInt(maxEl.value);
          if (fill) {
            const percentMin = ((newMin - sliderMin) / range) * 100;
            const percentMax = ((newMax - sliderMin) / range) * 100;
            fill.style.left = percentMin + "%";
            fill.style.width = Math.max(0, percentMax - percentMin) + "%";
          }
          if (minLbl) minLbl.textContent = formatMinutesShort(newMin);
          if (maxLbl) maxLbl.textContent = formatMinutesShort(newMax);
        }

        // Re-run filtering
        filterAndSortStreams();
      });
    });

    // Initial render & filter
    filterAndSortStreams();

  } catch (err) {
    console.error("[Init] Error:", err);
    const vg = document.getElementById("video-grid");
    if (vg) vg.innerHTML =
      "<p style='text-align:center;color:#aaa;'>Error loading data.</p>";
  }
}

// Conditional page init
if (!window.IS_COLLAB_PAGE && !window.location.pathname.includes("suggest")) {
  console.log("[Main] Initializing Main UI...");
  initMainPage();
} else {
  console.log("[Main] Skipping Main UI (Collab/Suggest Page)");
}

// Suggest Tag button
document.getElementById("suggestTagBtn")?.addEventListener("click", () => {
  window.location.href = "suggest.html";
});

// === TAG COLLAPSE TOGGLE (3-STAGE) ===
const collapseBtn = document.getElementById("collapseTagsBtn");
const tagFilterContainer = document.querySelector(".tag-section");

let collapseStage = 0; // 0 = all visible, 1 = only included/excluded shown, 2 = none shown

function hasActiveFilters() {
  return Object.values(tagStates).some(v => v === "include" || v === "exclude");
}

function applyTagCollapseState() {
  const section = document.querySelector(".tag-section");
  if (!section || !collapseBtn) return;

  // select ALL tag buttons inside the section, regardless of wrapper
  const buttons = section.querySelectorAll(".tag-btn");
  if (!buttons.length) return;

  // collapse logic
  if (collapseStage === 0) {
    buttons.forEach(b => b.style.display = "");
    collapseBtn.querySelector("span").textContent = "Collapse ◂";
  } else if (collapseStage === 1) {
    buttons.forEach(b => {
      const name = b.textContent.trim();
      const s = tagStates[name];
      b.style.display = (s === "include" || s === "exclude") ? "" : "none";
    });
    collapseBtn.querySelector("span").textContent = "Collapse ALL ◂";
  } else { // stage 2
    buttons.forEach(b => b.style.display = "none");
    collapseBtn.querySelector("span").textContent = "Expand Tags ▸";
  }
}


// Initialize collapse stage properly on load
collapseStage = 0; // ensure starts expanded
applyTagCollapseState(); // render initial state

let collapseClickedOnce = false;

if (collapseBtn) {
  collapseBtn.addEventListener("click", () => {
    collapseClickedOnce = true;  // mark that user has interacted

    if (IS_COLLAB_PAGE) return;

    // If there are no included/excluded tags, skip mid stage
    if (!hasActiveFilters()) {
      collapseStage = (collapseStage === 0) ? 2 : 0;
    } else {
      collapseStage = (collapseStage + 1) % 3;
    }

    applyTagCollapseState();
  });
}


// initialize label/visual to match current state on load
if (!IS_COLLAB_PAGE) applyTagCollapseState();

