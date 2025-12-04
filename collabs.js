// ============== UTILITIES ===============

if (document.body.classList.contains("collab-page")) {
  // Disable main page tag logic on collab page
  window.tagStates = undefined;
  window.applyTagCollapseState = () => {};
}

function extractVideoId(val) {
  if (!val) return null;
  return /^[a-zA-Z0-9_-]{11}$/.test(val) ? val : null;
}


function parseDurationToMinutes(iso) {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  const h = parseInt(match?.[1] || 0);
  const m = parseInt(match?.[2] || 0);
  const s = parseInt(match?.[3] || 0);
  return h * 60 + m + s / 60;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function formatMinutesToHM(mins) {
  const h = Math.floor(mins / 60);
  const m = Math.round(mins % 60);
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

// =============== CSV LOAD ===============

function loadCollabCSV() {
  const el = document.getElementById("collabs");
  if (!el) return [];

  const lines = el.textContent.trim().split("\n").filter(x => x.trim());
  const headers = lines[0].split(",");
  const rows = lines.slice(1);

  return rows.map(r => {
    const cols = r.split(",");
    const obj = {};
    headers.forEach((h, i) => (obj[h.trim()] = (cols[i] || "").trim()));
    return obj;
  });
}

async function loadExtraCSV(url) {
  const res = await fetch(url);
  const text = await res.text();

  const lines = text.trim().split("\n").filter(x => x.trim());
  const headers = lines[0].split(",");

  return lines.slice(1).map(r => {
    const cols = r.split(",");
    const obj = {};
    headers.forEach((h, i) => (obj[h.trim()] = (cols[i] || "").trim()));
    return obj;
  });
}


// ================ TAG UI =================

let collabTagStates = {};

function createTagButtons(tagNames) {
  const container = document.getElementById("tag-filters");
  if (!container) return;

  // Do not rebuild if tags already exist
  if (container.querySelector(".tag-btn")) return;

  tagNames.forEach(tag => {
    collabTagStates[tag] = "none";

    const btn = document.createElement("button");
    btn.className = "tag-btn";
    btn.innerHTML = `<span>${tag}</span>`;

    btn.addEventListener("click", () => {
      const next = { none: "include", include: "exclude", exclude: "none" }[
        collabTagStates[tag]
      ];

      collabTagStates[tag] = next;

      btn.classList.remove("include", "exclude");
      if (next === "include") btn.classList.add("include");
      if (next === "exclude") btn.classList.add("exclude");

      filterAndSortStreams();
    });

    container.appendChild(btn);
  });
}

// ============= DURATION SLIDER =========

const minSlider = document.getElementById("durationMin");
const maxSlider = document.getElementById("durationMax");
const fillBar =
  document.getElementById("durationRangeFill") ||
  document.getElementById("rangeFill");

function formatTimeForSlider(mins) {
  if (mins >= 999) return "999";
  const h = Math.floor(mins / 60);
  const m = Math.floor(mins % 60);
  return `${h}:${m.toString().padStart(2, "0")}`;
}

function setupDurationSlider(maxVal) {
  if (!minSlider || !maxSlider) return;
  minSlider.step = maxSlider.step = 1;

  minSlider.max = maxVal;
  maxSlider.max = maxVal;

  updateDurationSliderUI();
}


function updateDurationSliderUI(event) {
  let minVal = parseInt(minSlider.value);
  let maxVal = parseInt(maxSlider.value);

  // Prevent slider crossing
  if (minVal > maxVal) {
    if (event?.target === minSlider) maxSlider.value = minVal;
    else minSlider.value = maxVal;
    minVal = parseInt(minSlider.value);
    maxVal = parseInt(maxSlider.value);
  }

  // Update labels
  document.getElementById("durationMinLabel").textContent =
    formatTimeForSlider(minVal);
  document.getElementById("durationMaxLabel").textContent =
    formatTimeForSlider(maxVal);

  // Update fill bar
  const range = maxSlider.max - minSlider.min;
  const left = ((minVal - minSlider.min) / range) * 100;
  const right = ((maxVal - minSlider.min) / range) * 100;
  fillBar.style.left = left + "%";
  fillBar.style.width = right - left + "%";

  filterAndSortStreams();
}

minSlider?.addEventListener("input", updateDurationSliderUI);
maxSlider?.addEventListener("input", updateDurationSliderUI);

// ========= FRIEND COUNT SLIDER =========

const friendMin = document.getElementById("friendMin");
const friendMax = document.getElementById("friendMax");
const friendFill = document.getElementById("friendRangeFill");

function formatFriendLabel(n) {
  return n >= 10 ? "10+" : n.toString();
}

function updateFriendSliderUI(event) {
  let minVal = parseInt(friendMin.value);
  let maxVal = parseInt(friendMax.value);

  if (minVal > maxVal) {
    if (event?.target === friendMin) friendMax.value = minVal;
    else friendMin.value = maxVal;
    minVal = parseInt(friendMin.value);
    maxVal = parseInt(friendMax.value);
  }

  document.getElementById("friendMinLabel").textContent =
    formatFriendLabel(minVal);
  document.getElementById("friendMaxLabel").textContent =
    formatFriendLabel(maxVal);

  const range = friendMax.max - friendMin.min;
  const left = ((minVal - friendMin.min) / range) * 100;
  const right = ((maxVal - friendMin.min) / range) * 100;
  friendFill.style.left = left + "%";
  friendFill.style.width = right - left + "%";

  filterAndSortStreams();
}

friendMin?.addEventListener("input", updateFriendSliderUI);
friendMax?.addEventListener("input", updateFriendSliderUI);

// ============== DATA FETCH ===============

let allCollabStreams = [];

async function fetchVideoData(ids) {
  const chunks = [];
  for (let i = 0; i < ids.length; i += 50) chunks.push(ids.slice(i, i + 50));

  let results = [];
  for (const c of chunks) {
    const url = `https://www.googleapis.com/youtube/v3/videos?part=contentDetails,snippet&id=${c.join(
      ","
    )}&key=${API_KEY}`;
    const data = await ytFetch(url);
    results.push(...(data.items || []));
    await new Promise(r => setTimeout(r, 150));
  }

  return results.map(v => ({
    id: v.id,
    title: v.snippet.title,
    date: v.snippet.publishedAt,
    durationMinutes: parseDurationToMinutes(v.contentDetails.duration),
    thumbnail: v.snippet.thumbnails?.high?.url || "",
    channel_name: v.snippet.channelTitle
  }));

}

// ============ DISPLAY + FILTER ==========

function displayStreams(list) {
  const grid = document.getElementById("video-grid");
  if (!grid) return;

  if (!list.length) {
    grid.innerHTML =
      "<p style='text-align:center;color:#aaa;'>No streams found.</p>";
    return;
  }

  grid.innerHTML = list
    .map(s => {
      return `
      <div class="video-card">
        <a href="https://youtu.be/${s.id}" target="_blank" class="thumb-link">
          <img src="${s.thumbnail}" alt="${escapeHtml(s.title)}" loading="lazy">
        </a>
        <div class="video-info">
          <h3>${escapeHtml(s.title)}</h3>
          <div class="video-meta">
            <p class="video-date">${s.formattedDate}</p>
            <p class="video-duration">${formatMinutesToHM(s.durationMinutes)}</p>
          </div>
        </div>
      </div>`;
    })
    .join("");
}

function streamHasTag(stream, tag) {
  if (!stream?.tags) return false;
  const val = String(stream.tags[tag] || "").trim();
  return val !== "";
}

function filterAndSortStreams() {
  const search =
    (document.getElementById("searchInput")?.value || "").toLowerCase();
  const min = parseInt(document.getElementById("durationMin")?.value || 0);
  const max = parseInt(document.getElementById("durationMax")?.value || 9999);

  const sort = collabSortOrder;

  const includeTags = Object.entries(collabTagStates)
    .filter(([_, v]) => v === "include")
    .map(([k]) => k);

  const excludeTags = Object.entries(collabTagStates)
    .filter(([_, v]) => v === "exclude")
    .map(([k]) => k);

  const minFriends = parseInt(friendMin?.value || 1);
  const maxFriends = parseInt(friendMax?.value || 10);

  const filtered = allCollabStreams.filter(s => {
    const matchesDuration =
      s.durationMinutes >= min && s.durationMinutes <= max;
    const matchesText =
      s.title.toLowerCase().includes(search) ||
      (s.channel_name || "").toLowerCase().includes(search) ||
      s.formattedDate.toLowerCase().includes(search);


    const hasIncluded = includeTags.every(t => streamHasTag(s, t));
    const hasExcluded = excludeTags.some(t => streamHasTag(s, t));

    const friends = parseInt(s.friend_count || 1);

    return (
      matchesDuration &&
      matchesText &&
      hasIncluded &&
      !hasExcluded &&
      friends >= minFriends &&
      friends <= maxFriends
    );
  });

  filtered.sort((a, b) => {
    if (sort === "oldest") return new Date(a.date) - new Date(b.date);
    return new Date(b.date) - new Date(a.date);
  });

  document.getElementById(
    "streamCount"
  ).textContent = `Showing ${filtered.length} stream${
    filtered.length === 1 ? "" : "s"
  }`;

  displayStreams(filtered);
}

// =========== SORT TOGGLE ================

let collabSortOrder = "newest";

// ================ INIT ==================

async function initCollabsPage() {
  const csv = loadCollabCSV();
  const baseIds = csv.map(r => extractVideoId(r.stream_link)).filter(Boolean);

  // -------- Load external metadata.csv --------
  let extraRows = [];
  try {
    extraRows = await loadExtraCSV("metadata.csv");
  } catch (e) {
    console.warn("[Collabs] Could not load metadata.csv", e);
  }

  // Filter rows where Collab > 0 and valid ID
  const extraIds = extraRows
    .filter(r => parseFloat(r.Collab) > 0)
    .map(r => extractVideoId(r.stream_link))
    .filter(Boolean);

  // ------- Merge, dedupe --------
  const ids = [...new Set([...baseIds, ...extraIds])];

  // ------- Fetch metadata from YouTube -------
  const data = await fetchVideoData(ids);

  // ------- Combine into unified objects -------
  allCollabStreams = data.map(s => {
    // Try to match the original collabs CSV
    const idx = baseIds.indexOf(s.id);
    const csvRow = idx >= 0 ? csv[idx] : null;

    const tags = {};
    if (csvRow) {
      Object.keys(csvRow).forEach(k => {
        if (k !== "stream_link" && k !== "friend_count") {
          tags[k] = csvRow[k].trim();
        }
      });
    }
 
    // Add manual tag: true if imported from metadata.csv
    tags["Cuu Stream"] = csvRow ? "" : "Yes";


    // Friend count logic:
    // - Base CSV uses friend_count column
    // - Extra CSV uses the Collab numeric value
    let friendCount;
    if (csvRow) {
      friendCount = parseFloat(csvRow.friend_count) || 1;
    } else {
      // from metadata.csv
      friendCount = parseFloat(
        extraRows.find(r => extractVideoId(r.stream_link) === s.id)?.Collab
      ) || 1;
    }


    const d = new Date(s.date);
    const formattedDate =
      d.toLocaleDateString("en-GB", { month: "long", day: "numeric" }) +
      " '" + String(d.getFullYear()).slice(-2);

    return {
      ...s,
      tags,
      friend_count: friendCount,
      formattedDate
    };
  });

  // ------- UI Setup -------
    let tagNames = Object.keys(csv[0]).filter(
      k => k !== "stream_link" && k !== "friend_count"
    );

    // Add manual tag "Cuu Stream"
    tagNames.push("Cuu Stream");

  createTagButtons(tagNames);

const maxDur = Math.ceil(
  Math.max(...allCollabStreams.map(s => s.durationMinutes))
);

setupDurationSlider(maxDur);


  document
    .getElementById("searchInput")
    ?.addEventListener("input", filterAndSortStreams);

  filterAndSortStreams();
}

window.addEventListener("load", () => {
  updateFriendSliderUI();
});

document.addEventListener("DOMContentLoaded", () => {
  const toggle = document.getElementById("sortToggle");
  if (toggle) {
    toggle.addEventListener("click", () => {
      collabSortOrder = collabSortOrder === "newest" ? "oldest" : "newest";
      toggle.textContent =
        collabSortOrder === "newest"
          ? "Newest First ▾"
          : "Oldest First ▴";
      toggle.classList.toggle("active", collabSortOrder === "oldest");
      filterAndSortStreams();
    });
  }

  console.log("[Collabs] Initializing...");
  initCollabsPage();
});
