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

  // Fallback to label text if no placeholder found
  const label = findLabelText(element);
  if (label) return label;

  return null;
}

function extractFormFields() {
  const selectors =
    "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]), textarea";
  const elements = Array.from(document.querySelectorAll(selectors)).filter((el) => {
    if (el.disabled) return false;
    const val = (el.value ?? "").toString().trim();
    return !val;
  });
  const usedKeys = new Set();

  return elements.map((element, index) => {
    const label = findLabelText(element);
    const placeholder = getActualPlaceholder(element);
    const baseKey = label || element.name || element.id || element.type || `field_${index}`;
    const key = createElementKey(baseKey, index, usedKeys);

    return {
      key,
      tagName: element.tagName,
      type: element.type || null,
      id: element.id || null,
      name: element.name || null,
      placeholder,
      label: label || null,
      selector: getElementSelector(element),
      value: element.value || null,
    };
  });
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
You are an AI resume parser.

Your task is to extract values from the resume based ONLY on the provided fields.

Instructions:
- The input field names are provided in "FIELDS TO EXTRACT".
- Create a JSON object where:
  - key = field name from "FIELDS TO EXTRACT"
  - value = matching information found in the resume
- If a value is not found in the resume, return "NOTFOUND".
- Do not create extra fields.
- Do not rename fields.
- Return ONLY raw JSON.
- No explanations, no markdown, no code block.

FIELDS TO EXTRACT:
${payload.fields.map((field) => field.key).join(", ")}

RESUME:
${payload.resume}
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

  // Extract JSON safely
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

async function promptForMissingValues(missingFields) {
  return new Promise((resolve) => {
    // Create modal overlay
    const modal = document.createElement("div");
    modal.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: rgba(0, 0, 0, 0.7);
      backdrop-filter: blur(5px);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 10000;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: fadeIn 0.3s ease-out;
    `;

    // Create form container
    const formContainer = document.createElement("div");
    formContainer.style.cssText = `
      background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
      padding: 30px;
      border-radius: 16px;
      box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
      max-width: 600px;
      width: 90%;
      max-height: 80vh;
      overflow-y: auto;
      border: 1px solid rgba(255, 255, 255, 0.2);
      animation: slideIn 0.3s ease-out;
    `;

    // Add keyframes for animations
    const style = document.createElement("style");
    style.textContent = `
      @keyframes fadeIn {
        from { opacity: 0; }
        to { opacity: 1; }
      }
      @keyframes slideIn {
        from { transform: translateY(-20px); opacity: 0; }
        to { transform: translateY(0); opacity: 1; }
      }
      .form-field {
        margin-bottom: 20px;
      }
      .form-field label {
        display: block;
        margin-bottom: 8px;
        font-weight: 600;
        color: #2c3e50;
        font-size: 14px;
      }
      .form-field input {
        width: 100%;
        padding: 12px 16px;
        border: 2px solid #e1e8ed;
        border-radius: 8px;
        font-size: 16px;
        transition: all 0.3s ease;
        box-sizing: border-box;
      }
      .form-field input:focus {
        outline: none;
        border-color: #007bff;
        box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
      }
      .submit-btn {
        width: 100%;
        padding: 14px;
        background: linear-gradient(135deg, #007bff 0%, #0056b3 100%);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 16px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        margin-top: 10px;
      }
      .submit-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(0, 123, 255, 0.3);
      }
      .submit-btn:active {
        transform: translateY(0);
      }
      .form-field-wrapper {
        position: relative;
        display: flex;
        align-items: flex-end;
      }
      .form-field-wrapper > div {
        flex: 1;
      }
      .ai-fill-btn {
        margin-left: 10px;
        padding: 10px 14px;
        background: linear-gradient(135deg, #6c63ff 0%, #5a47d4 100%);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: all 0.3s ease;
        white-space: nowrap;
        opacity: 0;
        visibility: hidden;
        transform: translateX(10px);
      }
      .form-field-wrapper:hover .ai-fill-btn {
        opacity: 1;
        visibility: visible;
        transform: translateX(0);
      }
      .ai-fill-btn:hover {
        transform: scale(1.05);
        box-shadow: 0 4px 12px rgba(108, 99, 255, 0.3);
      }
      .ai-fill-btn:active {
        transform: scale(0.95);
      }
      .ai-fill-btn.loading {
        opacity: 0.6;
        cursor: not-allowed;
      }
    `;
    document.head.appendChild(style);

    // Title
    const title = document.createElement("h3");
    title.textContent = "Complete Your Application";
    title.style.cssText = `
      margin: 0 0 25px 0;
      color: #2c3e50;
      font-size: 24px;
      font-weight: 700;
      text-align: center;
    `;

    const subtitle = document.createElement("p");
    subtitle.textContent = "Please provide the missing information below:";
    subtitle.style.cssText = `
      margin: 0 0 30px 0;
      color: #6c757d;
      font-size: 16px;
      text-align: center;
    `;

    formContainer.appendChild(title);
    formContainer.appendChild(subtitle);

    // Create form
    const form = document.createElement("form");
    form.style.cssText = `
      display: flex;
      flex-direction: column;
    `;

    const inputs = {};
    const aiFilledKeys = new Set();
    let cachedResumeText = null;

    async function getResumeFromDB() {
      if (cachedResumeText) return cachedResumeText;

      try {
        // Wait for database to be ready
        const isReady = await dbReady;
        if (!isReady) {
          throw new Error("Database failed to initialize.");
        }

        const resume = await db.resumes.get("default");

        if (!resume || !resume.file) {
          throw new Error("No resume found in database. Please upload your resume first.");
        }

        const resumeText = getResumeText(resume.file);
        cachedResumeText = resumeText;
        return resumeText;
      } catch (error) {
        throw error;
      }
    }

    function getPageContext() {
      const pageTitle = document.title || "";
      const pageUrl = window.location.href || "";
      const pageText = document.body?.innerText?.trim() || "";
      const normalizedText = pageText.replace(/\s+/g, " ").trim();
      return {
        title: pageTitle,
        url: pageUrl,
        text: normalizedText.slice(-15000),
      };
    }

    async function fillFieldWithAI(field) {
      try {
        const pageContext = getPageContext();
        console.log("Page context for AI:", pageContext);
        const resumeData = await new Promise((resolve, reject) => {
          chrome.storage.local.get(["resume"], (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error("Failed to retrieve resume from storage"));
            } else if (!result.resume) {
              reject(new Error("No resume found in storage"));
            } else {
              resolve(result.resume);
            }
          });
        });

        // Convert resume data to text
        let resumeText = "";
        if (typeof resumeData === "string") {
          resumeText = resumeData;
        } else if (typeof resumeData === "object") {
          resumeText = JSON.stringify(resumeData, null, 2);
        }

        if (!resumeText || !resumeText.trim()) {
          throw new Error("Resume data is empty or invalid.");
        }

        const prompt = `
give me only value for this application field based on the resume and the current page context provided. Do not give extra text.
FIELD TO EXTRACT:
Field Name: "${field.label || field.placeholder || field.key}"

PAGE CONTEXT:
Title: ${pageContext.title}
URL: ${pageContext.url}
Text: ${pageContext.text}

RESUME:
${resumeText}
`;
        const { apiKey, model } = await getApiSettings();
        if (!apiKey || !model) {
          throw new Error(
            "API key or model is not configured. Please open the extension popup and save your API settings.",
          );
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
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

        return { value: value, filledWithAi: true };
      } catch (error) {
        alert("Error: " + error.message);
        return "NOTFOUND";
      }
    }

    missingFields.forEach((field) => {
      const fieldWrapper = document.createElement("div");
      fieldWrapper.className = "form-field-wrapper";

      const fieldContainer = document.createElement("div");
      fieldContainer.className = "form-field";

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
      fieldWrapper.appendChild(fieldContainer);

      const aiBtn = document.createElement("button");
      aiBtn.type = "button";
      aiBtn.className = "ai-fill-btn";
      aiBtn.textContent = "🤖 Fill with AI";
      aiBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();

        try {
          aiBtn.classList.add("loading");
          aiBtn.textContent = "⏳ Loading...";
          aiBtn.disabled = true;

          await fillFieldWithAI(field);
        } catch (error) {
          alert("Error: " + error.message);
        } finally {
          aiBtn.classList.remove("loading");
          aiBtn.textContent = "🤖 Fill with AI";
          aiBtn.disabled = false;
        }
      });

      fieldWrapper.appendChild(aiBtn);
      form.appendChild(fieldWrapper);

      inputs[field.key] = input;
    });

    // Submit button
    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.textContent = "Submit & Auto-Fill Application";
    submitBtn.className = "submit-btn";

    form.appendChild(submitBtn);
    formContainer.appendChild(form);
    modal.appendChild(formContainer);
    document.body.appendChild(modal);

    form.addEventListener("submit", async (e) => {
      e.preventDefault();

      const values = {};
      missingFields.forEach((field) => {
        const value = inputs[field.key].value.trim();
        if (value) {
          values[field.key] = value;
        }
      });

      // Remove modal and style
      document.body.removeChild(modal);
      document.head.removeChild(style);

      resolve({ values, aiFilledKeys: Array.from(aiFilledKeys) });
    });

    // Close on click outside
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
        document.head.removeChild(style);
        resolve({ values: {}, aiFilledKeys: Array.from(aiFilledKeys) });
      }
    });
  });
}

async function autoFillFields(extractedFields, fieldValues) {
  const missingFields = [];
  const filledValues = {};
  let resumeFile = null;

  try {
    resumeFile = await getResumeFileFromIndexedDB();
  } catch (error) {
    console.log("No resume file available for file inputs:", error.message);
  }
  // Load any previously saved resume values from chrome.storage
  const storedResume = await new Promise((resolve) => {
    try {
      chrome.storage.local.get(["resume"], (result) => {
        resolve(result?.resume || {});
      });
    } catch (e) {
      resolve({});
    }
  });

  for (const field of extractedFields) {
    console.log("field ---------> ", field);
    if (field.type === "file") {
      const element = findFieldElement(field);
      if (element && resumeFile) {
        autoFillFileInput(element, resumeFile);
        filledValues[field.key] = "RESUME_FILE_UPLOADED";
      } else {
        console.log("Skipping manual prompt for file field:", field.key);
      }
      continue;
    }

    const element = findFieldElement(field) || document.querySelector(field.selector);
    const pageValue = element?.value?.toString().trim();

    // Prefer LLM output keyed by field.key, but fall back to placeholder/label
    const llmValue =
      (fieldValues &&
        (fieldValues[field.key] ?? fieldValues[field.placeholder] ?? fieldValues[field.label])) ||
      null;

    // Also check stored resume values (from chrome.storage.local)
    const storedValue =
      (storedResume &&
        (storedResume[field.key] ??
          storedResume[field.placeholder] ??
          storedResume[field.label])) ||
      null;

    // Final chosen value: LLM -> stored -> page (if any)
    const value = llmValue ?? storedValue ?? pageValue;

    console.log(`Filling field "${field.key}" with value:`, value, {
      llmValue,
      storedValue,
      pageValue,
    });

    if (value && value !== "NOTFOUND") {
      filledValues[field.key] = value;
      fillInputField(element, value);
    } else {
      missingFields.push(field);
    }
  }

  if (missingFields.length > 0) {
    const { values: manualValues, aiFilledKeys } = await promptForMissingValues(missingFields);
    const valuesToSave = {};

    for (const [key, value] of Object.entries(manualValues)) {
      if (value) {
        filledValues[key] = value;
        if (!aiFilledKeys.includes(key)) {
          valuesToSave[key] = value;
        }
        const field = extractedFields.find((f) => f.key === key);
        if (field) {
          const element = findFieldElement(field);
          fillInputField(element, value);
        }
      }
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

/**
 * Get resume file from IndexedDB via background script
 */
function getResumeFileFromIndexedDB() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "GET_RESUME_FROM_IDB" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error("Failed to retrieve resume: " + chrome.runtime.lastError.message));
      } else if (response?.success) {
        // Convert the response back to a File object
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

/**
 * Find all file input elements (resume uploads) on the page
 */
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
    // Try using DataTransfer first (most reliable)
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
    } catch (e) {
      // Fallback: try direct assignment
      console.log("DataTransfer not available, trying direct assignment...");

      // Create a mock File list object
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

    // Dispatch change and input events
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));

    // Also dispatch focus and blur events to ensure proper detection
    fileInput.dispatchEvent(new Event("focus", { bubbles: true }));
    fileInput.dispatchEvent(new Event("blur", { bubbles: true }));

    console.log("Resume automatically filled in file input:", fileInput.name || fileInput.id);
    return true;
  } catch (error) {
    console.log("Could not auto-fill file input:", error.message);
    return false;
  }
}

/**
 * Auto-fill all detected file inputs with resume
 */
function autoFillAllFileInputs(file) {
  const fileInputs = findFileInputs();
  if (fileInputs.length === 0) {
    console.log("No file inputs found on page");
    return;
  }

  console.log(`Found ${fileInputs.length} file input(s), filling with resume...`);

  fileInputs.forEach((fileInput) => {
    autoFillFileInput(fileInput, file);
  });
}

async function performAutoApply(resumeData) {
  const extractedFields = extractFormFields();

  if (!extractedFields.length) {
    throw new Error("No form fields were found on this page.");
  }

  // Convert resume data to text for LLM processing
  let resumeText = "";
  if (typeof resumeData === "string") {
    resumeText = resumeData;
  } else if (typeof resumeData === "object") {
    // Convert resume JSON to readable text format
    resumeText = JSON.stringify(resumeData, null, 2);
  }

  if (!resumeText || !resumeText.trim()) {
    throw new Error("Resume data is empty or invalid.");
  }

  // Send extracted fields and resume to LLM for intelligent mapping
  const fieldValues = await callGeminiApi({
    fields: extractedFields,
    resume: resumeText,
  });

  console.log("✅✅✅✅ LLM returned field values:", fieldValues);

  const resumeUpdates = Object.fromEntries(
    Object.entries(fieldValues).filter(([, value]) => value && value !== "NOTFOUND"),
  );
  if (Object.keys(resumeUpdates).length > 0) {
    await saveResumeFields(resumeUpdates);
  }

  await autoFillFields(extractedFields, fieldValues);

  // Auto-fill file input fields with resume from IndexedDB
  try {
    const resumeFile = await getResumeFileFromIndexedDB();
    autoFillAllFileInputs(resumeFile);
  } catch (error) {
    console.log("Could not auto-fill file inputs:", error.message);
    // Don't throw error - file auto-fill is optional, form fields are more important
  }

  return {
    success: true,
    message:
      "Fields were populated. Missing values were requested manually and stored for future use.",
  };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "START_AUTO_APPLY") return;

  performAutoApply(message.resumeData)
    .then((result) => sendResponse(result))
    .catch((error) => {
      sendResponse({ success: false, error: error.message || "Auto apply failed." });
    });

  return true;
});
