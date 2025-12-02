// ==== suggest.js ====

document.addEventListener("DOMContentLoaded", initSuggest);
console.log("In suggest.js, emailjs is:", typeof emailjs);

async function initSuggest() {
  console.log("Suggest Tag page initializing...");

  // Core elements
  const input = document.getElementById("tagNameInput");
  const list = document.getElementById("video-grid"); // use same container as main page
  const submit = document.getElementById("submitTag");
  const searchBox = document.getElementById("searchStreams");
  const suggestPage = document.querySelector(".suggest-page");

  let chosenTag = "";
  let existingTags = [];
  let metadataRows = [];
  let metadataLoaded = false;

  if (!input || !list || !submit) {
    console.warn("Missing essential DOM elements on suggest.html — skipping setup.");
    return;
  }

  // --- Load metadata.csv ---
  try {
    const res = await fetch("metadata.csv");
    if (!res.ok) throw new Error("Failed to fetch CSV");
    const csvText = await res.text();
    metadataRows = parseCSV(csvText);

    const header = metadataRows[0];
    existingTags = header.slice(1, -2); // skip stream_link and last 2 columns (zatsu_start, stream_title)
    metadataLoaded = true;

    console.log("Loaded existing tags:", existingTags);
  } catch (err) {
    console.error("Could not load metadata.csv — submission disabled", err);
    metadataLoaded = false;

    const warn = document.createElement("p");
    warn.style.color = "#cc3333";
    //warn.textContent =
    //  "⚠️ Could not load stream metadata — you cannot submit suggestions right now.";
    suggestPage.prepend(warn);

    submit.disabled = true;
  }

// --- Fetch or reuse main-page streams ---
let videos = await fetchAllStreams();
console.log(videos)

// Ensure cached streams have formattedDate (like main page)
videos = videos.map(s => {
  if (!s.formattedDate && s.date) {
    const d = new Date(s.date);
    const options = { month: 'long', day: 'numeric' };
    s.formattedDate = d.toLocaleDateString('en-GB', options) + " '" + String(d.getFullYear()).slice(-2);
  }
  return s;
});

window.videos = videos; // expose globally if needed


  const yesSelections = new Set();
  const noSelections = new Set();

  // --- Tag input behavior ---
function handleTagInput() {
  const value = input.value.trim();
  
  if (!value) {
    chosenTag = "";
    submit.disabled = true;
    input.classList.add("missing-tag"); // highlight empty
    return;
  }

  chosenTag = value;
  input.disabled = true;
  input.classList.remove("missing-tag"); // remove highlight
  input.classList.add("filled");
  showTagBanner(chosenTag);

  if (metadataLoaded) submit.disabled = false;
}


  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleTagInput();
    }
  });

  input.addEventListener("change", handleTagInput);

  function showTagBanner(tagName) {
    const tagBanner = document.getElementById("tagBanner");
    const tagBannerText = document.getElementById("tagBannerText");
    const changeBtn = document.getElementById("changeTagBtn");

    tagBannerText.textContent = `Tagging "${tagName}"`;
    tagBanner.classList.remove("hidden");

    changeBtn.onclick = () => {
      input.disabled = false;
      input.focus();
      input.classList.remove("filled");
      tagBanner.classList.add("hidden");
    };
  }

// --- Search filter ---
if (searchBox) {
  searchBox.addEventListener("input", (e) => {
    const query = e.target.value.toLowerCase();
    list.querySelectorAll(".stream-item").forEach((item) => {
      const title = item.querySelector(".stream-title").textContent.toLowerCase();
      const date = item.querySelector(".video-meta p")?.textContent.toLowerCase() || "";
      item.style.display = (title.includes(query) || date.includes(query)) ? "" : "none";
    });
  });
}


  // --- Render streams using main page style ---
  renderStreams(videos, list, yesSelections, noSelections);

  // --- Modal elements ---
  const modal = document.getElementById("submitModal");
  const modalMessage = document.getElementById("modalMessage");
  const modalDiscord = document.getElementById("modalDiscord");
  const modalCredit = document.getElementById("modalCredit");
  const modalCreditName = document.getElementById("modalCreditName");
  const modalCreditLabel = document.getElementById("modalCreditNameLabel");
  const modalCancel = document.getElementById("modalCancel");
  const modalSubmit = document.getElementById("modalSubmit");

  // Toggle credit name input
  modalCredit.addEventListener("change", () => {
    modalCreditLabel.style.display = modalCredit.checked ? "block" : "none";
  });

  // Cancel modal
  modalCancel.addEventListener("click", () => {
    modal.classList.add("hidden");
  });


  // --- Submit handler ---
submit.addEventListener("click", () => {
  // Reset modal fields
  modalMessage.value = "";
  modalDiscord.value = "";
  modalCredit.checked = false;
  modalCreditName.value = "";
  modalCreditLabel.style.display = "none";

  // Show modal
  modal.classList.remove("hidden");
});

modalSubmit.addEventListener("click", async () => {
  const tagName = input.value.trim();
  const message = modalMessage.value.trim();
  const discordUser = modalDiscord.value.trim();
  const credit = modalCredit.checked;
  const creditName = credit ? modalCreditName.value.trim() : "";

  const header = ["stream_link", ...existingTags, tagName, "zatsu_start", "stream_title"];
  const rows = [header.join(",")];
  const metadataMap = {};
  for (let i = 1; i < metadataRows.length; i++) {
    const row = metadataRows[i];
    metadataMap[row[0]] = row;
  }
  for (const v of videos) {
    const id = v.id;
    const metaRow = metadataMap[id] || [];
    const title = v.title.replace(/"/g, '""');
    const existingTagValues = existingTags.map((_, idx) => metaRow[idx + 1] || "");
    let newTagValue = "";
    if (yesSelections.has(id)) newTagValue = "1";
    else if (noSelections.has(id)) newTagValue = "0";
    const zatsu = metaRow[existingTags.length + 1] || "";
    rows.push([id, ...existingTagValues, newTagValue, zatsu, `"${title}"`].join(","));
  }

  try {
    await emailjs.send("service_wk26mhd","template_6eyzp4i",{
      tag_name: tagName,
      csv_text: rows.join("\n"),
      message,
      discord_user: discordUser,
      credit,
      credit_name: creditName
    });
    alert("📨 Suggestion sent! Thank you for helping to improve Cuudex.");
    modal.classList.add("hidden");
  } catch (err) {
    console.error(err);
    alert("❌ Failed to send suggestion. Please try again later.");
  }
});


function renderStreams(videos, container, yesSelections, noSelections) {
  container.innerHTML = ""; // clear old content

  for (const v of videos) {
    const card = document.createElement("div");
    card.className = "video-card stream-item";
    card.innerHTML = `
      <a href="https://youtu.be/${v.id}" target="_blank" class="thumb-link">
        <img src="${v.thumbnail}" alt="${v.title}" loading="lazy" />
      </a>
      <div class="video-info">
        <h3 class="stream-title">${v.title}</h3>
        <div class="video-meta">
          <p class="video-date">${v.formattedDate || ""}</p>
          <div class="buttons">
            <button class="btn-yes" data-id="${v.id}">✅</button>
            <button class="btn-no" data-id="${v.id}">❌</button>
          </div>
        </div>
      </div>
    `;
    container.appendChild(card);
  }

  // Attach click handler **once**
  if (!container.hasClickHandler) {
    container.addEventListener("click", (e) => {
      const item = e.target.closest(".stream-item");
      if (!item) return;
      const id = e.target.dataset.id;
      if (!id) return;

      if (e.target.classList.contains("btn-yes")) {
        yesSelections.add(id);
        noSelections.delete(id);
        item.classList.add("yes");
        item.classList.remove("no");
        e.target.classList.add("selected");
        e.target.nextElementSibling.classList.remove("selected");
      } else if (e.target.classList.contains("btn-no")) {
        noSelections.add(id);
        yesSelections.delete(id);
        item.classList.add("no");
        item.classList.remove("yes");
        e.target.classList.add("selected");
        e.target.previousElementSibling.classList.remove("selected");
      }
    });
    container.hasClickHandler = true;
  }
}}

// ---- CSV parser: handles quoted titles ----
function parseCSV(csv) {
  return csv
    .trim()
    .split("\n")
    .map((line) => {
      let parts = line.match(/(".*?"|[^,]+)(?=\s*,|\s*$)/g);
      if (!parts) return [];

      const title = parts.pop();

      parts = parts.map((p) => {
        p = p.trim();
        if (p.startsWith('"') && p.endsWith('"')) return p.slice(1, -1).replace(/""/g, '"');
        return p;
      });

      parts.push(title);
      return parts;
    });
}


