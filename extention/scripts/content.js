createFloatingBot();
injectAutoApplyGlobalStyles();

function createFloatingBot() {
  if (document.getElementById("autoapply-bot")) return;

  const bot = document.createElement("div");

  bot.id = "autoapply-bot";
  bot.innerHTML = `
  <img
    src="${chrome.runtime.getURL("../images/bot5.png")}"
    alt="ApplyFlow Bot"
    id="bot-image"
  />
`;

  document.body.appendChild(bot);

  makeDraggable(bot);

  bot.addEventListener("click", () => {
    toggleSidebar();
  });
}

function getOrCreateSidebar() {
  let sidebar = document.getElementById("autoapply-sidebar");
  if (sidebar) return sidebar;

  sidebar = document.createElement("div");
  sidebar.id = "autoapply-sidebar";
  sidebar.innerHTML = `
      <iframe
          id="autoapply-frame"
          src="${chrome.runtime.getURL("popup/popup.html")}"
      ></iframe>
  `;

  // Force a compact, chatbot-widget shape (fixed size, floating, rounded)
  // instead of a tall full-height panel. Using setProperty(..., "important")
  // so this wins over any existing sidebar CSS from elsewhere.
  const chatbotSizing = {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    top: "auto",
    left: "auto",
    width: "380px",
    height: "620px",
    "max-height": "80vh",
    "border-radius": "18px",
    overflow: "hidden",
    "box-shadow": "0 18px 45px rgba(15, 23, 42, 0.25)",
    "z-index": "2147483000",
  };
  Object.entries(chatbotSizing).forEach(([prop, value]) => {
    sidebar.style.setProperty(prop, value, "important");
  });

  document.body.appendChild(sidebar);

  const frame = sidebar.querySelector("#autoapply-frame");
  if (frame) {
    frame.style.setProperty("width", "100%", "important");
    frame.style.setProperty("height", "100%", "important");
    frame.style.setProperty("border", "none", "important");
    frame.style.setProperty("display", "block", "important");
  }

  return sidebar;
}

function toggleSidebar() {
  const existing = document.getElementById("autoapply-sidebar");
  if (existing) {
    existing.remove();
    return;
  }
  getOrCreateSidebar();
}

// ─── SHARED ENGAGING LOADER ────────────────────────────────────────────────────
// One full-sidebar loader, reused by "Start Auto Apply" and "Submit & Auto-Fill",
// so both flows show the same progress-style loading experience (e.g. "Filling
// fields (3/8)..."). This is separate from the per-field AI button, which only
// shows its own inline spinner and never triggers this overlay.
function injectAutoApplyGlobalStyles() {
  if (document.getElementById("aa-global-style")) return;

  const style = document.createElement("style");
  style.id = "aa-global-style";
  style.textContent = `
    .aa-sidebar-loader {
      position: absolute;
      top: 78px;
      right: 0;
      bottom: 0;
      left: 0;
      background: rgba(255, 255, 255, 0.97);
      z-index: 30;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: aaFadeIn 0.2s ease-out;
    }
    .aa-sidebar-loader.aa-hidden {
      display: none !important;
      pointer-events: none;
    }
    .aa-sidebar-loader-card {
      padding: 24px 28px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.14);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      max-width: 80%;
      text-align: center;
    }
    .aa-sidebar-loader-ring {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 4px solid rgba(59, 97, 255, 0.15);
      border-top-color: #3b64ff;
      animation: aaRingSpin 0.9s linear infinite;
    }
    .aa-sidebar-loader-text {
      color: #22303c;
      font-weight: 600;
      font-size: 13px;
      line-height: 1.4;
    }
    @keyframes aaFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes aaRingSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

function getOrCreateSidebarLoader() {
  injectAutoApplyGlobalStyles();
  const sidebar = getOrCreateSidebar();

  let loader = sidebar.querySelector("#aa-sidebar-loader");
  if (loader) return loader;

  loader = document.createElement("div");
  loader.id = "aa-sidebar-loader";
  loader.className = "aa-sidebar-loader aa-hidden";
  loader.innerHTML = `
    <div class="aa-sidebar-loader-card">
      <div class="aa-sidebar-loader-ring"></div>
      <div class="aa-sidebar-loader-text">Loading...</div>
    </div>
  `;
  sidebar.appendChild(loader);
  return loader;
}

function showSidebarLoader(message) {
  const loader = getOrCreateSidebarLoader();
  loader.querySelector(".aa-sidebar-loader-text").textContent = message;
  loader.classList.remove("aa-hidden");
}

function updateSidebarLoader(message) {
  const sidebar = document.getElementById("autoapply-sidebar");
  const loader = sidebar?.querySelector("#aa-sidebar-loader");
  if (loader) loader.querySelector(".aa-sidebar-loader-text").textContent = message;
}

function hideSidebarLoader() {
  const sidebar = document.getElementById("autoapply-sidebar");
  const loader = sidebar?.querySelector("#aa-sidebar-loader");
  if (loader) loader.classList.add("aa-hidden");
}

function makeDraggable(element) {
  let isDragging = false;

  let offsetX = 0;
  let offsetY = 0;

  element.addEventListener("mousedown", (e) => {
    isDragging = true;

    const rect = element.getBoundingClientRect();

    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;

    element.style.left = rect.left + "px";
    element.style.top = rect.top + "px";
    element.style.right = "auto";

    e.preventDefault();
  });

  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;

    let x = e.clientX - offsetX;
    let y = e.clientY - offsetY;

    const maxX = window.innerWidth - element.offsetWidth;
    const maxY = window.innerHeight - element.offsetHeight;

    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));

    element.style.left = x + "px";
    element.style.top = y + "px";
  });

  document.addEventListener("mouseup", () => {
    isDragging = false;
  });
}

async function getApiSettings() {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(["apiKey", "model"], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error("Failed to load API settings."));
      } else {
        resolve({ apiKey: result.apiKey || "", model: result.model || "" });
      }
    });
  });
}

function findLabelText(element) {
  if (!element) return null;

  if (element.id) {
    const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (label?.innerText) return label.innerText.trim();
  }

  const parentLabel = element.closest("label");
  if (parentLabel?.innerText) return parentLabel.innerText.trim();

  return null;
}

function createElementKey(base, index, usedKeys) {
  let key = base || `field_${index}`;
  let suffix = 1;
  while (usedKeys.has(key)) {
    key = `${base || `field_${index}`}_${suffix}`;
    suffix += 1;
  }
  usedKeys.add(key);
  return key;
}

function getActualPlaceholder(element) {
  const placeholder = element.getAttribute("placeholder")?.trim();
  if (placeholder) return placeholder;

  const ariaLabel = element.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;

  const title = element.getAttribute("title")?.trim();
  if (title) return title;

  const label = findLabelText(element);
  if (label) return label;

  return null;
}

// ─── COMBINE RESUME + PROFILE DATA ─────────────────────────────────────────────
// Merges the parsed resume with the user's saved profile (contact info, links,
// EEO/demographic answers, etc.) into a single labeled context block so every
// LLM call — radio groups, dropdowns, free-text fields, and the manual-fill
// AI button — can draw on both sources instead of resume text alone.
function buildApplicantContext(resumeData, profileData) {
  const toText = (data) => {
    if (!data) return "";
    if (typeof data === "string") return data.trim();
    try {
      return JSON.stringify(data, null, 2).trim();
    } catch (e) {
      return "";
    }
  };

  const resumeText = toText(resumeData);
  const profileText = toText(profileData);

  const sections = [];
  if (resumeText) {
    sections.push(`RESUME:\n${resumeText}`);
  }
  if (profileText) {
    sections.push(
      `PROFILE INFORMATION (saved user profile — prefer this for contact details, links, location, and questions the resume doesn't cover; the resume is the primary source for work history, skills, and experience):\n${profileText}`,
    );
  }

  return sections.join("\n\n");
}

/**
 * Looks up a value for `field` inside profileData, trying key, placeholder,
 * and label as candidate property names (mirrors how storedResume lookups
 * work in autoFillFields).
 */
function getProfileValueForField(profileData, field) {
  if (!profileData || typeof profileData !== "object") return null;
  return (
    profileData[field.key] ?? profileData[field.placeholder] ?? profileData[field.label] ?? null
  );
}

// Replace the old extractFormFields() function with this:
function extractFormFields() {
  const extractor = new FormFieldExtractor({ includeFilled: false });
  const fields = extractor.extract(document);

  // Map FormFieldExtractor's shape onto the shape the rest of content.js expects.
  return fields.map((f) => ({
    key: f.key,
    tagName: f.tagName,
    type: f.type,
    id: f.id,
    name: f.name,
    placeholder: f.placeholder,
    label: f.label,
    selector: f.locator.selector, // flattened selector (top-level DOM)
    locator: f.locator, // keep the full locator around too, for resolveFieldElement below
    value: f.value,
    isDropdown: f.isDropdown,
  }));
}

// ─── EXTRACT RADIO GROUPS ──────────────────────────────────────────────────────
function extractRadioGroups() {
  const allRadios = Array.from(document.querySelectorAll('input[type="radio"]:not([disabled])'));

  if (!allRadios.length) return [];

  // Group by name attribute first, then by proximity for unnamed radios
  const namedGroups = {};
  const unnamedRadios = [];

  allRadios.forEach((radio) => {
    if (radio.name) {
      if (!namedGroups[radio.name]) namedGroups[radio.name] = [];
      namedGroups[radio.name].push(radio);
    } else {
      unnamedRadios.push(radio);
    }
  });

  const groups = [];

  // Process named groups
  Object.entries(namedGroups).forEach(([name, radios]) => {
    // Skip if already checked (user already answered)
    const alreadyChecked = radios.some((r) => r.checked);

    // Find group label by looking for a fieldset/legend or common ancestor label
    const groupLabel = findRadioGroupLabel(radios) || name;

    const options = radios.map((radio) => {
      const label =
        findLabelText(radio) ||
        radio.value ||
        radio.getAttribute("aria-label") ||
        radio.id ||
        radio.value;
      return {
        el: radio,
        value: radio.value,
        label: label.trim(),
        selector: getElementSelector(radio),
      };
    });

    groups.push({
      name,
      groupLabel,
      options,
      alreadyChecked,
      selector: getElementSelector(radios[0]),
    });
  });

  return groups;
}

// ─── FIND RADIO GROUP LABEL ────────────────────────────────────────────────────
function findRadioGroupLabel(radios) {
  if (!radios.length) return null;

  // 1. Look for a <legend> in a parent <fieldset>
  const fieldset = radios[0].closest("fieldset");
  if (fieldset) {
    const legend = fieldset.querySelector("legend");
    if (legend?.innerText) return legend.innerText.trim();
  }

  // 2. Look for aria-labelledby on a common ancestor
  let ancestor = radios[0].parentElement;
  for (let i = 0; i < 6; i++) {
    if (!ancestor) break;
    const labelledBy = ancestor.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl?.innerText) return labelEl.innerText.trim();
    }
    const ariaLabel = ancestor.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    ancestor = ancestor.parentElement;
  }

  // 3. Look for a heading or label element just before the first radio's container
  const container = radios[0].closest("div, section, li, p") || radios[0].parentElement;
  if (container) {
    const prev = container.previousElementSibling;
    if (prev) {
      const text = prev.innerText?.trim();
      if (text && text.length < 120) return text;
    }
    // Also check for a label/heading inside the container but before the first radio
    const headings = container.querySelectorAll("h1,h2,h3,h4,h5,h6,label,p,span");
    for (const h of headings) {
      if (!h.contains(radios[0]) && h.innerText?.trim()) {
        return h.innerText.trim();
      }
    }
  }

  return null;
}

// ─── LLM RADIO SELECTOR ───────────────────────────────────────────────────────
async function getRadioChoiceFromLLM(groupLabel, options, applicantContext) {
  const { apiKey, model } = await getApiSettings();

  const optionLabels = options.map((o) => o.label);

  const prompt = `
You are filling out a job application form.
Question / Field: "${groupLabel}"
Available radio options:
${optionLabels.join(", ")}
Based on the applicant data below (resume and/or profile), return ONLY one exact option from the available options above.
No explanation. No punctuation. No extra text. Just the option label exactly as written.
Applicant data:
${applicantContext}
  `.trim();

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
  });

  const data = await response.json();
  const chosen = data?.choices?.[0]?.message?.content?.trim();
  if (!chosen) {
    console.warn(`LLM returned empty for radio group "${groupLabel}"`);
    return null;
  }
  return chosen;
}

// ─── FILL RADIO GROUP ─────────────────────────────────────────────────────────
async function fillRadioGroup(group, applicantContext) {
  try {
    if (group.alreadyChecked) {
      return;
    }

    if (!group.options.length) {
      console.warn(`No options for radio group "${group.groupLabel}"`);
      return;
    }

    let chosenLabel = await getRadioChoiceFromLLM(
      group.groupLabel,
      group.options,
      applicantContext,
    );
    chosenLabel = chosenLabel?.trim()?.replace(/^["'`\s]+|["'`\s]+$/g, "");

    if (!chosenLabel) return;

    // Find best matching option (exact first, then partial)
    const matched =
      group.options.find((o) => o.label.toLowerCase() === chosenLabel.toLowerCase()) ??
      group.options.find((o) => o.label.toLowerCase().includes(chosenLabel.toLowerCase())) ??
      group.options.find((o) => chosenLabel.toLowerCase().includes(o.label.toLowerCase()));

    if (!matched) {
      console.warn(`No radio option matched "${chosenLabel}" for "${group.groupLabel}"`);
      return;
    }

    // Get the live radio element from the DOM
    const radioEl =
      matched.el ||
      document.querySelector(matched.selector) ||
      document.querySelector(
        `input[type="radio"][name="${CSS.escape(group.name)}"][value="${CSS.escape(matched.value)}"]`,
      );

    if (!radioEl) {
      console.warn(`Could not find radio DOM element for "${matched.label}"`);
      return;
    }

    // Click the radio button (also handles label-wrapped radios)
    radioEl.focus();
    radioEl.click();

    // Also dispatch change/input events for framework compatibility
    radioEl.dispatchEvent(new Event("change", { bubbles: true }));
    radioEl.dispatchEvent(new Event("input", { bubbles: true }));

    // If the radio has an associated label, click that too (some frameworks need it)
    const associatedLabel =
      radioEl.closest("label") ||
      document.querySelector(`label[for="${CSS.escape(radioEl.id || "")}"]`);
    if (associatedLabel && associatedLabel !== radioEl) {
      associatedLabel.click();
    }

    await sleep(150);
  } catch (err) {
    console.error(`Error filling radio group "${group.groupLabel}":`, err);
  }
}

function getElementSelector(element) {
  if (!element) return null;
  const path = [];
  let node = element;

  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
    let selector = node.nodeName.toLowerCase();
    if (node.id) {
      selector += `#${CSS.escape(node.id)}`;
      path.unshift(selector);
      break;
    }

    const siblingIndex =
      Array.from(node.parentNode.children)
        .filter((sibling) => sibling.nodeName === node.nodeName)
        .indexOf(node) + 1;
    selector += siblingIndex > 1 ? `:nth-of-type(${siblingIndex})` : "";
    path.unshift(selector);
    node = node.parentNode;
  }

  return path.join(" > ");
}

function extractJsonFromText(text) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("No JSON object found in Gemini response.");
  }
  return text.slice(firstBrace, lastBrace + 1);
}

async function callGeminiApi(payload) {
  const prompt = `
You are an AI resume/profile parser.

Your task is to extract values from the applicant data based ONLY on the provided fields.

Instructions:
- The input field names are provided in "FIELDS TO EXTRACT".
- Create a JSON object where:
  - key = field name from "FIELDS TO EXTRACT"
  - value = matching information found in the applicant data (resume and/or profile)
- Prefer the profile section for contact details, links, and location; prefer the resume for work history, skills, and experience.
- If a value is not found in either, return "NOTFOUND".
- Do not create extra fields.
- Do not rename fields.
- Return ONLY raw JSON.
- No explanations, no markdown, no code block.

FIELDS TO EXTRACT:
${payload.fields.map((field) => field.key).join(", ")}

APPLICANT DATA:
${payload.context}
`;

  const { apiKey, model } = await getApiSettings();
  if (!apiKey || !model) {
    throw new Error(
      "API key or model is not configured. Please open the extension popup and save your API settings.",
    );
  }

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0.3,
    }),
  });

  if (!resp.ok) {
    const txt = await resp.text();
    throw new Error(`LLM request failed: ${resp.status} ${txt}`);
  }

  const json = await resp.json();

  const content =
    json?.choices?.[0]?.message?.content ||
    json?.choices?.[0]?.delta?.content ||
    json?.output?.[0]?.content?.[0]?.text;

  if (!content) {
    throw new Error("No content returned from LLM.");
  }

  const firstBrace = content.indexOf("{");
  const lastBrace = content.lastIndexOf("}");

  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("No valid JSON found in LLM response.");
  }

  const jsonText = content.slice(firstBrace, lastBrace + 1);

  try {
    return JSON.parse(jsonText);
  } catch (err) {
    throw new Error("Failed to parse LLM JSON response.");
  }
}

function findFieldElement(field) {
  if (!field) return null;

  if (field.selector) {
    const element = document.querySelector(field.selector);
    if (element) return element;
  }

  if (field.id) {
    const byId = document.getElementById(field.id);
    if (byId) return byId;
  }

  if (field.name) {
    const byName = document.querySelector(`[name="${CSS.escape(field.name)}"]`);
    if (byName) return byName;
  }

  if (field.placeholder) {
    const byPlaceholder = document.querySelector(
      `input[placeholder="${CSS.escape(field.placeholder)}"], textarea[placeholder="${CSS.escape(field.placeholder)}"]`,
    );
    if (byPlaceholder) return byPlaceholder;
  }

  if (field.label) {
    const labels = Array.from(document.querySelectorAll("label"));
    const matchingLabel = labels.find(
      (labelEl) => labelEl.innerText.trim().toLowerCase() === field.label.trim().toLowerCase(),
    );
    if (matchingLabel) {
      const fieldId = matchingLabel.getAttribute("for");
      if (fieldId) {
        const byLabelFor = document.getElementById(fieldId);
        if (byLabelFor) return byLabelFor;
      }
    }
  }

  return null;
}

function fillInputField(element, value) {
  if (!element) return;

  element.focus();
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

async function promptForMissingValues(missingFields, profileData) {
  return new Promise((resolve) => {
    const sidebar = getOrCreateSidebar();

    // remove any stale modal so they don't stack
    sidebar.querySelector(".aa-inline-modal")?.remove();

    const style = document.createElement("style");
    style.textContent = `
      .aa-inline-modal {
  position: absolute;
  top: 78px;
  right: 0;
  bottom: 0;
  left: 0;
  background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
  z-index: 20;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  animation: aaFadeIn 0.2s ease-out;
  box-shadow: 0 -8px 20px rgba(15, 23, 42, 0.08);
}
      @keyframes aaFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .aa-inline-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 18px 4px;
      }
      .aa-inline-modal-header h3 {
        margin: 0;
        color: #2c3e50;
        font-size: 17px;
        font-weight: 700;
      }
      .aa-inline-modal-close {
        border: none;
        background: #f1f3f5;
        color: #495057;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
      }
      .aa-inline-modal-close:hover { background: #e9ecef; }
      .aa-inline-modal-subtitle {
        margin: 6px 18px 16px;
        color: #6c757d;
        font-size: 13px;
      }
      .aa-inline-modal-form {
        padding: 0 18px 18px;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        gap: 4px;
        position: relative;
        z-index: 5;

        scrollbar-width: none;      /* Firefox */
        -ms-overflow-style: none;   /* old Edge/IE */
      }
      .aa-inline-modal-form::-webkit-scrollbar {
        display: none;               /* Chrome/Safari/new Edge */
      }
      .aa-form-field { margin-bottom: 14px; }
      .aa-form-field label {
        display: block;
        margin-bottom: 6px;
        font-weight: 600;
        color: #2c3e50;
        font-size: 13px;
      }
      .aa-form-field input {
        width: 100%;
        padding: 10px 12px;
        border: 2px solid #e1e8ed;
        border-radius: 8px;
        font-size: 14px;
        box-sizing: border-box;
      }
      .aa-form-field input:focus {
        outline: none;
        border-color: #007bff;
        box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
      }
      .aa-field-wrapper { display: flex; align-items: flex-end; gap: 6px; }
      .aa-field-wrapper > .aa-form-field { flex: 1; margin-bottom: 14px; }
      .aa-ai-fill-btn {
        padding: 9px 10px;
        background: linear-gradient(135deg, #6c63ff 0%, #5a47d4 100%);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        margin-bottom: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.2s ease;
        z-index: 5;
      }
      .aa-ai-fill-btn:hover:not(.loading) { transform: scale(1.05); }
      .aa-ai-fill-btn.loading {
        opacity: 0.9;
        cursor: not-allowed;
      }
      .aa-ai-btn-spinner {
        display: none;
        width: 12px;
        height: 12px;
        flex: none;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.4);
        border-top-color: #ffffff;
        animation: aaInlineSpin 0.7s linear infinite;
      }
      .aa-ai-fill-btn.loading .aa-ai-btn-spinner {
        display: inline-block;
      }
      .aa-ai-btn-label {
        line-height: 1;
      }
      .aa-submit-btn {
        margin-top: auto;
        position: sticky;
        bottom: 0;
        width: 100%;
        padding: 14px;
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: white;
        border: none;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 -4px 12px rgba(37, 99, 235, 0.15), 0 4px 12px rgba(37, 99, 235, 0.3);
        z-index: 5;
      }
      .aa-submit-btn:hover:not(.loading) { 
        transform: translateY(-2px);
        box-shadow: 0 -4px 12px rgba(37, 99, 235, 0.15), 0 6px 16px rgba(37, 99, 235, 0.4);
      }
      .aa-submit-btn:active:not(.loading) { 
        transform: translateY(0);
      }
      .aa-submit-btn.loading {
        opacity: 0.75;
        cursor: not-allowed;
      }
      .aa-submit-btn.loading::before {
        content: "";
        position: absolute;
        top: 50%;
        left: 50%;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.55);
        animation: aaButtonSpinner 0.9s linear infinite;
        z-index: 10;
      }
      .aa-submit-btn.loading {
        color: transparent;
      }
      @keyframes aaButtonSpinner {
        from { transform: translate(-50%, -50%) rotate(0deg); }
        to { transform: translate(-50%, -50%) rotate(360deg); }
      }
      @keyframes aaInlineSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    const modal = document.createElement("div");
    modal.className = "aa-inline-modal";

    const header = document.createElement("div");
    header.className = "aa-inline-modal-header";
    header.innerHTML = `<h3>Complete Your Application</h3>`;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "aa-inline-modal-close";
    closeBtn.innerHTML = "&times;";
    header.appendChild(closeBtn);

    const subtitle = document.createElement("p");
    subtitle.className = "aa-inline-modal-subtitle";
    subtitle.textContent = "Please provide the missing information below:";

    const form = document.createElement("form");
    form.className = "aa-inline-modal-form";

    const inputs = {};
    const aiFilledKeys = new Set();

    function getPageContext() {
      const pageTitle = document.title || "";
      const pageUrl = window.location.href || "";
      const pageText = document.body?.innerText?.trim() || "";
      const normalizedText = pageText.replace(/\s+/g, " ").trim();
      return { title: pageTitle, url: pageUrl, text: normalizedText.slice(-15000) };
    }

    async function fillFieldWithAI(field) {
      try {
        const pageContext = getPageContext();
        const resumeData = await new Promise((resolve, reject) => {
          chrome.storage.local.get(["resume"], (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error("Failed to retrieve resume from storage"));
            } else {
              resolve(result.resume || null);
            }
          });
        });

        const applicantContext = buildApplicantContext(resumeData, profileData);
        if (!applicantContext) {
          throw new Error("No resume or profile data available. Add one in the extension popup.");
        }

        const prompt = `
give me only value for this application field based on the applicant's data and the current page context provided. Do not give extra text.
FIELD TO EXTRACT:
Field Name: "${field.label || field.placeholder || field.key}"

PAGE CONTEXT:
Title: ${pageContext.title}
URL: ${pageContext.url}
Text: ${pageContext.text}

APPLICANT DATA:
${applicantContext}
`;
        const { apiKey, model } = await getApiSettings();
        if (!apiKey || !model) {
          throw new Error(
            "API key or model is not configured. Please open the extension popup and save your API settings.",
          );
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
          }),
        });

        if (!response.ok) {
          const txt = await response.text();
          throw new Error(`LLM request failed: ${response.status} ${txt}`);
        }

        const data = await response.json();
        const value = data?.choices?.[0]?.message?.content?.trim() || "NOTFOUND";

        if (value && value !== "NOTFOUND") {
          inputs[field.key].value = value;
          inputs[field.key].dispatchEvent(new Event("input", { bubbles: true }));
          inputs[field.key].dispatchEvent(new Event("change", { bubbles: true }));
          aiFilledKeys.add(field.key);
        }
      } catch (error) {
        alert("Error: " + error.message);
      }
    }

    missingFields.forEach((field) => {
      const wrapper = document.createElement("div");
      wrapper.className = "aa-field-wrapper";

      const fieldContainer = document.createElement("div");
      fieldContainer.className = "aa-form-field";

      const label = document.createElement("label");
      label.textContent = field.label || field.placeholder || field.key;
      label.htmlFor = field.key;

      const input = document.createElement("input");
      input.type = "text";
      input.id = field.key;
      input.name = field.key;
      input.placeholder = `Enter ${field.label || field.placeholder || field.key}`;

      fieldContainer.appendChild(label);
      fieldContainer.appendChild(input);
      wrapper.appendChild(fieldContainer);

      const aiBtn = document.createElement("button");
      aiBtn.type = "button";
      aiBtn.className = "aa-ai-fill-btn";
      aiBtn.innerHTML = `
        <span class="aa-ai-btn-spinner"></span>
        <span class="aa-ai-btn-label">🤖 AI</span>
      `;
      const aiBtnLabel = aiBtn.querySelector(".aa-ai-btn-label");

      aiBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        aiBtn.classList.add("loading");
        aiBtn.disabled = true;
        await fillFieldWithAI(field);
        aiBtn.classList.remove("loading");
        aiBtn.disabled = false;
      });

      wrapper.appendChild(aiBtn);
      form.appendChild(wrapper);
      inputs[field.key] = input;
    });

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.textContent = "Submit & Auto-Fill";
    submitBtn.className = "aa-submit-btn";
    form.appendChild(submitBtn);

    modal.appendChild(header);
    modal.appendChild(subtitle);
    modal.appendChild(form);
    sidebar.appendChild(modal);

    function cleanup(result) {
      modal.remove();
      style.remove();
      resolve(result);
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.classList.add("loading");
      submitBtn.textContent = "";

      const values = {};
      missingFields.forEach((field) => {
        const value = inputs[field.key].value.trim();
        if (value) values[field.key] = value;
      });

      // Hand off to the same engaging, progress-style loader used by
      // "Start Auto Apply" — it takes over once the modal closes and the
      // collected values are actually written into the page fields.
      showSidebarLoader("Submitting your answers...");
      cleanup({ values, aiFilledKeys: Array.from(aiFilledKeys) });
    });

    closeBtn.addEventListener("click", () => {
      cleanup({ values: {}, aiFilledKeys: Array.from(aiFilledKeys) });
    });
  });
}

async function autoFillFields(extractedFields, fieldValues, onProgress, profileData) {
  const missingFields = [];
  const filledValues = {};
  let resumeFile = null;

  try {
    resumeFile = await getResumeFileFromIndexedDB();
  } catch (error) {
    console.log("No resume file available for file inputs:", error.message);
  }

  const storedResume = await new Promise((resolve) => {
    try {
      chrome.storage.local.get(["resume"], (result) => {
        resolve(result?.resume || {});
      });
    } catch (e) {
      resolve({});
    }
  });

  const total = extractedFields.length;
  let processedCount = 0;

  for (const field of extractedFields) {
    processedCount += 1;

    if (field.type === "file") {
      const element = findFieldElement(field);
      if (element && resumeFile) {
        autoFillFileInput(element, resumeFile);
        filledValues[field.key] = "RESUME_FILE_UPLOADED";
      } else {
        console.log("Skipping manual prompt for file field:", field.key);
      }
      if (onProgress) onProgress(processedCount, total);
      continue;
    }

    const element = findFieldElement(field) || document.querySelector(field.selector);
    const pageValue = element?.value?.toString().trim();

    const llmValue =
      (fieldValues &&
        (fieldValues[field.key] ?? fieldValues[field.placeholder] ?? fieldValues[field.label])) ||
      null;

    const storedValue =
      (storedResume &&
        (storedResume[field.key] ??
          storedResume[field.placeholder] ??
          storedResume[field.label])) ||
      null;

    // Profile data (contact info, links, location, EEO answers, etc.) is
    // checked after the LLM's answer and the saved resume, but before
    // falling back to whatever is already on the page.
    const profileValue = getProfileValueForField(profileData, field);

    const value = llmValue ?? storedValue ?? profileValue ?? pageValue;

    if (value && value !== "NOTFOUND") {
      filledValues[field.key] = value;
      fillInputField(element, value);
    } else {
      missingFields.push(field);
    }

    if (onProgress) onProgress(processedCount, total);
  }

  if (missingFields.length > 0) {
    // Hide the engaging loader before the modal opens — the modal needs to be
    // visible to the user, not covered by the loading overlay.
    hideSidebarLoader();

    const { values: manualValues, aiFilledKeys } = await promptForMissingValues(
      missingFields,
      profileData,
    );
    const valuesToSave = {};

    const manualEntries = Object.entries(manualValues).filter(([, value]) => value);
    const manualTotal = manualEntries.length;

    if (manualTotal > 0) {
      // Reuse the same engaging, progress-style loader as "Start Auto Apply"
      // while the collected answers are actually written into the page.
      showSidebarLoader(`Filling submitted fields (0/${manualTotal})...`);
    }

    let manualFilled = 0;
    for (const [key, value] of manualEntries) {
      filledValues[key] = value;
      if (!aiFilledKeys.includes(key)) {
        valuesToSave[key] = value;
      }
      const field = extractedFields.find((f) => f.key === key);
      if (field) {
        const element = findFieldElement(field);
        fillInputField(element, value);
      }
      manualFilled += 1;
      updateSidebarLoader(`Filling submitted fields (${manualFilled}/${manualTotal})...`);
      await sleep(150);
    }

    if (manualTotal > 0) {
      hideSidebarLoader();
    }

    if (Object.keys(valuesToSave).length > 0) {
      await saveResumeFields(valuesToSave);
    }
  }

  return filledValues;
}

function saveResumeFields(values) {
  return new Promise((resolve, reject) => {
    if (!values || Object.keys(values).length === 0) {
      resolve();
      return;
    }

    chrome.storage.local.get(["resume"], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error("Could not access chrome storage to save resume values."));
        return;
      }

      let existingResume = result?.resume;
      if (typeof existingResume === "string") {
        existingResume = { rawText: existingResume };
      }
      if (!existingResume || typeof existingResume !== "object") {
        existingResume = {};
      }

      const mergedResume = { ...existingResume, ...values };
      chrome.storage.local.set({ resume: mergedResume }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error("Failed to save resume values to storage."));
        } else {
          resolve();
        }
      });
    });
  });
}

function getResumeFileFromIndexedDB() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "GET_RESUME_FROM_IDB" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error("Failed to retrieve resume: " + chrome.runtime.lastError.message));
      } else if (response?.success) {
        const { fileData, fileName, fileType } = response.file;
        const blobArray = new Uint8Array(Object.values(fileData));
        const blob = new Blob([blobArray], { type: fileType });
        const file = new File([blob], fileName, { type: fileType });
        resolve(file);
      } else {
        reject(new Error(response?.error || "No resume found in local database"));
      }
    });
  });
}

function findFileInputs() {
  const selectors = [
    'input[type="file"]',
    'input[type="file"][accept*="pdf"]',
    'input[type="file"][accept*="doc"]',
    'input[type="file"][accept*="resume"]',
    'input[accept*="pdf"]',
    'input[accept*="resume"]',
    'input[name*="resume"]',
    'input[name*="cv"]',
    'input[name*="document"]',
    'input[id*="resume"]',
    'input[id*="cv"]',
    'input[id*="document"]',
  ];

  const fileInputs = new Set();
  selectors.forEach((selector) => {
    try {
      document.querySelectorAll(selector).forEach((input) => {
        if (input.type === "file" && !input.disabled) {
          fileInputs.add(input);
        }
      });
    } catch (e) {
      console.log("Invalid selector:", selector, e.message);
    }
  });

  return Array.from(fileInputs);
}

function autoFillFileInput(fileInput, file) {
  try {
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
    } catch (e) {
      const fileList = {
        0: file,
        length: 1,
        item: function (index) {
          return this[index] || null;
        },
      };

      Object.defineProperty(fileInput, "files", {
        value: fileList,
        writable: true,
      });
    }

    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    fileInput.dispatchEvent(new Event("focus", { bubbles: true }));
    fileInput.dispatchEvent(new Event("blur", { bubbles: true }));

    return true;
  } catch (error) {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Watch for menu div being ADDED, grab options before it disappears ─────────
function captureOptionsOnMutation(triggerFn, timeout = 3000) {
  return new Promise((resolve) => {
    let resolved = false;

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;

          const optionEls = extractOptionEls(node);

          if (optionEls.length > 0 && !resolved) {
            resolved = true;
            observer.disconnect();
            resolve(optionEls);
            return;
          }
        }
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });

    triggerFn();

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        resolve([]);
      }
    }, timeout);
  });
}

// ─── Extract option elements from a container node ────────────────────────────
function extractOptionEls(node) {
  const SELECTORS = [
    '[class*="select__option"]',
    '[role="option"]',
    '[role="menuitemradio"]',
    "[data-radix-select-item]",
    ".MuiAutocomplete-option",
    ".MuiMenuItem-root",
    ".ant-select-item",
    "mat-option",
    '[data-automation-id="selectOption"]',
    ".dropdown-item",
    "li[data-value]",
  ].join(", ");

  const results = [];

  try {
    if (node.matches?.(SELECTORS)) results.push(node);
  } catch (_) {}

  try {
    results.push(...node.querySelectorAll(SELECTORS));
  } catch (_) {}

  return results;
}

// ─── Find the toggle button scoped to THIS field only ─────────────────────────
function getFieldTrigger(originalInput) {
  let shell = originalInput.parentElement;
  for (let i = 0; i < 8; i++) {
    if (!shell) break;
    const hasToggle = shell.querySelector('button[aria-label="Toggle flyout"]');
    const hasControl = shell.querySelector('[class*="select__control"]');
    if (hasToggle || hasControl) break;
    shell = shell.parentElement;
  }

  if (!shell) return originalInput;

  const toggleBtn = shell.querySelector('button[aria-label="Toggle flyout"]');
  if (toggleBtn) return toggleBtn;

  const control = shell.querySelector('[class*="select__control"]');
  if (control) return control;

  return originalInput;
}

// ─── EXTRACT OPTIONS ──────────────────────────────────────────────────────────
async function extractOptions(originalInput) {
  // ── 1. Native <select> ───────────────────────────────────────────────────
  if (originalInput.tagName === "SELECT") {
    return Array.from(originalInput.options)
      .filter((o) => o.text?.trim())
      .map((o) => ({ el: o, value: o.value, label: o.text.trim() }));
  }

  // ── 2. intl-tel-input country list (input#iti-*) ─────────────────────────
  if (originalInput.id?.startsWith("iti-") || originalInput.closest(".iti")) {
    const countryList = document.querySelector(".iti__country-list");
    if (countryList) {
      return Array.from(countryList.querySelectorAll("li.iti__standard, li[data-country-code]"))
        .map((el) => ({
          el,
          value: el.getAttribute("data-country-code") ?? el.textContent?.trim(),
          label:
            el.querySelector(".iti__country-name")?.textContent?.trim() ?? el.textContent?.trim(),
        }))
        .filter((o) => o.label);
    }
  }

  // ── 3. Hidden native <select> in same container ───────────────────────────
  let shell = originalInput.parentElement;
  for (let i = 0; i < 8; i++) {
    if (!shell) break;
    const sel = shell.querySelector("select");
    if (sel?.options?.length > 1) {
      return Array.from(sel.options)
        .filter((o) => o.text?.trim())
        .map((o) => ({ el: o, value: o.value, label: o.text.trim() }));
    }
    shell = shell.parentElement;
  }

  // ── 4. MutationObserver: capture the menu div the moment it's added ───────
  const trigger = getFieldTrigger(originalInput);

  const optionEls = await captureOptionsOnMutation(() => {
    trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    trigger.click();
  });

  await sleep(50);
  originalInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(100);

  if (optionEls.length > 0) {
    return optionEls
      .map((el) => ({
        el,
        value: el.dataset?.value ?? el.getAttribute("data-value") ?? el.textContent?.trim(),
        label: el.textContent?.trim(),
      }))
      .filter((o) => o.label?.trim());
  }

  return [];
}

// ─── LLM DROPDOWN MATCHER ─────────────────────────────────────────────────────
async function getMatchFromLLM(fieldLabel, options, applicantContext) {
  const { apiKey, model } = await getApiSettings();
  const optionLabels = [...new Set(options.map((o) => o.label))];

  const prompt = `
You are filling out a job application form.
Field: "${fieldLabel}"
Available options:
${optionLabels.join(", ")}
Based on the applicant data below (resume and/or profile), return ONLY one exact option from the available options.
No explanation. No punctuation. No extra text. Just the option.
Applicant data:
${applicantContext}
  `.trim();

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
  });

  const data = await response.json();
  const chosenLabel = data?.choices?.[0]?.message?.content?.trim();
  if (!chosenLabel) {
    console.warn(`LLM empty for "${fieldLabel}"`);
    return null;
  }

  return chosenLabel;
}

// ─── FILL DROPDOWN ────────────────────────────────────────────────────────────
async function fillDropdownFields(dropdownField, applicantContext) {
  try {
    if (!dropdownField?.selector) {
      console.warn("Missing selector:", dropdownField);
      return;
    }

    const originalInput = document.querySelector(dropdownField.selector);
    if (!originalInput) {
      console.warn(`Not found: "${dropdownField.label}" (${dropdownField.selector})`);
      return;
    }

    // ── Native <select> — simple .value assignment works ────────────────
    if (originalInput.tagName === "SELECT") {
      const options = await extractOptions(originalInput);
      if (!options.length) return;

      let matchedLabel = await getMatchFromLLM(dropdownField.label, options, applicantContext);
      matchedLabel = matchedLabel?.trim()?.replace(/^["'`\s]+|["'`\s]+$/g, "");
      if (!matchedLabel) return;

      const matched =
        options.find((o) => o.label.toLowerCase() === matchedLabel.toLowerCase()) ??
        options.find((o) => o.label.toLowerCase().includes(matchedLabel.toLowerCase()));

      if (!matched) {
        console.warn(`No option matched "${matchedLabel}" for "${dropdownField.label}"`);
        return;
      }

      originalInput.value = matched.value;
      originalInput.dispatchEvent(new Event("change", { bubbles: true }));
      originalInput.dispatchEvent(new Event("input", { bubbles: true }));
      return;
    }

    // ── Custom dropdown — must open it, click the option element ────────
    const options = await extractOptions(originalInput);
    if (!options.length) {
      console.warn(`❌ No options for "${dropdownField.label}"`);
      return;
    }

    let matchedLabel = await getMatchFromLLM(dropdownField.label, options, applicantContext);
    matchedLabel = matchedLabel?.trim()?.replace(/^["'`\s]+|["'`\s]+$/g, "");
    if (!matchedLabel) return;

    const matched =
      options.find((o) => o.label.toLowerCase() === matchedLabel.toLowerCase()) ??
      options.find((o) => o.label.toLowerCase().includes(matchedLabel.toLowerCase()));

    if (!matched) {
      console.warn(`No option matched "${matchedLabel}" for "${dropdownField.label}"`);
      return;
    }

    // Re-open the dropdown so the option element is live in the DOM
    const trigger = getFieldTrigger(originalInput);
    const optionEls = await captureOptionsOnMutation(() => {
      trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      trigger.click();
    });

    const targetEl =
      optionEls.find((el) => el.textContent?.trim().toLowerCase() === matchedLabel.toLowerCase()) ??
      optionEls.find((el) =>
        el.textContent?.trim().toLowerCase().includes(matchedLabel.toLowerCase()),
      );

    if (!targetEl) {
      console.warn(`Could not find live DOM element for "${matchedLabel}"`);
      originalInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return;
    }

    await sleep(50);
    targetEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    targetEl.click();
    targetEl.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

    await sleep(200);
  } catch (err) {
    console.error(`Error on "${dropdownField.label}":`, err);
  }
}

function autoFillAllFileInputs(file) {
  const fileInputs = findFileInputs();
  if (fileInputs.length === 0) {
    return;
  }

  fileInputs.forEach((fileInput) => {
    autoFillFileInput(fileInput, file);
  });
}

async function performAutoApply(resumeData, profileData) {
  showSidebarLoader("Scanning the form...");

  try {
    const extractedFields = extractFormFields();

    // Merge resume + profile once — every fill step below (radio groups,
    // dropdowns, free-text fields, and the manual "AI fill" button) draws
    // from this single combined context.
    const applicantContext = buildApplicantContext(resumeData, profileData);

    if (!applicantContext.trim()) {
      throw new Error("Resume and profile data are both empty or invalid.");
    }

    // ── 1. Fill radio button groups ────────────────────────────────────────
    const radioGroups = extractRadioGroups();
    if (radioGroups.length) {
      for (let i = 0; i < radioGroups.length; i++) {
        updateSidebarLoader(`Filling radio options (${i + 1}/${radioGroups.length})...`);
        await fillRadioGroup(radioGroups[i], applicantContext);
        await sleep(200);
      }
    }

    // ── 2. Fill dropdown fields ─────────────────────────────────────────────
    const dropdownFields = extractedFields.filter((field) => field.isDropdown === true);
    if (dropdownFields.length) {
      for (let i = 0; i < dropdownFields.length; i++) {
        updateSidebarLoader(`Filling dropdown fields (${i + 1}/${dropdownFields.length})...`);
        await fillDropdownFields(dropdownFields[i], applicantContext);
      }
    }

    // ── 3. Fill normal text/textarea fields via LLM ─────────────────────────
    const normalFields = extractedFields.filter((field) => field.isDropdown !== true);

    if (!normalFields.length && !dropdownFields.length && !radioGroups.length) {
      throw new Error("No form fields were found on this page.");
    }

    if (normalFields.length) {
      updateSidebarLoader(
        `Reading your resume and profile for ${normalFields.length} field${normalFields.length > 1 ? "s" : ""}...`,
      );
      const fieldValues = await callGeminiApi({
        fields: normalFields,
        context: applicantContext,
      });

      const resumeUpdates = Object.fromEntries(
        Object.entries(fieldValues).filter(([, value]) => value && value !== "NOTFOUND"),
      );
      if (Object.keys(resumeUpdates).length > 0) {
        await saveResumeFields(resumeUpdates);
      }

      updateSidebarLoader(`Filling fields (0/${normalFields.length})...`);
      await autoFillFields(
        normalFields,
        fieldValues,
        (done, total) => {
          updateSidebarLoader(`Filling fields (${done}/${total})...`);
        },
        profileData,
      );
    }

    // ── 4. Auto-fill file inputs ─────────────────────────────────────────────
    updateSidebarLoader("Attaching your resume file...");
    try {
      const resumeFile = await getResumeFileFromIndexedDB();
      autoFillAllFileInputs(resumeFile);
    } catch (error) {
      console.log("Could not auto-fill file inputs:", error.message);
    }

    return {
      success: true,
      message:
        "Fields were populated. Missing values were requested manually and stored for future use.",
    };
  } finally {
    hideSidebarLoader();
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "START_AUTO_APPLY") return;
  performAutoApply(message.resumeData, message.profileData)
    .then((result) => sendResponse(result))
    .catch((error) => {
      sendResponse({ success: false, error: error.message || "Auto apply failed." });
    });

  return true;
});
