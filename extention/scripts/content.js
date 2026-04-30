console.log("✅✅✅✅✅✅ Content script loaded");


// Initialize Dexie database
const db = new Dexie(AUTO_APPLY_DB_NAME);
db.version(1).stores({
  resumes: "id, name, createdAt",
  fieldValues: "key",
});

console.log("Dexie database initialized:", AUTO_APPLY_DB_NAME);

// Create a promise that resolves when database is ready
let dbReady = db
  .open()
  .then(() => {
    console.log("Database connection established");
    return true;
  })
  .catch((error) => {
    console.error("Failed to open database:", error);
    return false;
  });

function getIndexedDB() {
  return db;
}

async function saveFieldValue(key, value) {
  // Ensure database is ready
  await dbReady;

  await db.fieldValues.put({
    key,
    value,
    updatedAt: new Date().toISOString(),
  });

  console.log("Field value saved to database:", { key, value });
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
  const elements = Array.from(document.querySelectorAll(selectors)).filter((el) => !el.disabled);
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
  console.log("Calling Gemini API with payload:", payload);
  const prompt = `
You are an AI system that extracts and maps information from a resume to job application form fields.

YOUR TASK:
Extract information for each of the following fields from the resume. Return a JSON object where each key is exactly the field name and the value is the extracted information or "NOTFOUND" if not found in the resume.

FIELDS TO EXTRACT:
${payload.fields.map((f) => f.key).join(", ")}

STRICT RULES:
- Return ONLY a valid JSON object (no explanation, no text)
- Keys MUST exactly match: ${payload.fields.map((f) => `"${f.key}"`).join(", ")}
- Values MUST be extracted ONLY from the resume
- If a field is not clearly found in the resume → value must be "NOTFOUND"
- Preserve original formatting (emails, phone numbers, URLs)

RESUME:
${payload.resume}

`;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization:
        "Bearer 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",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: "qwen/qwen-2.5-7b-instruct",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json();

  const outputText = data?.choices?.[0]?.message?.content || "";

  console.log("response from qwen ", outputText);

  return JSON.parse(extractJsonFromText(outputText));
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
    let cachedResumeText = null;

    async function getResumeFromDB() {
      if (cachedResumeText) return cachedResumeText;

      try {
        // Wait for database to be ready
        const isReady = await dbReady;
        if (!isReady) {
          throw new Error("Database failed to initialize.");
        }

        console.log("Retrieving resume from Dexie database...");
        const resume = await db.resumes.get("default");

        console.log("Resume object from DB:", {
          exists: !!resume,
          hasFile: resume?.file ? "yes" : "no",
          fileName: resume?.name,
        });

        if (!resume || !resume.file) {
          throw new Error("No resume found in database. Please upload your resume first.");
        }

        console.log("Resume retrieved successfully");
        const resumeText = getResumeText(resume.file);
        cachedResumeText = resumeText;
        return resumeText;
      } catch (error) {
        console.error("Error retrieving resume from database:", error);
        throw error;
      }
    }

    async function fillFieldWithAI(field, resumeText) {
      const prompt = `Extract the most relevant value from the resume for this specific field: "${field.label || field.placeholder || field.key}"
      
Return ONLY the extracted value or "NOTFOUND" if not found. Do not include any explanations or quotes.

RESUME:
${resumeText}`;

      try {
        console.log("Sending request to Qwen API for field:", field.key);
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: {
            Authorization:
              "Bearer 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",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            model: "qwen/qwen-2.5-7b-instruct",
            messages: [{ role: "user", content: prompt }],
          }),
        });

        if (!response.ok) {
          throw new Error(`API error: ${response.status}`);
        }

        const data = await response.json();
        const value = data?.choices?.[0]?.message?.content?.trim() || "NOTFOUND";

        console.log("Response from Qwen for field", field.key, ":", value);

        if (value && value !== "NOTFOUND") {
          inputs[field.key].value = value;
          inputs[field.key].dispatchEvent(new Event("input", { bubbles: true }));
        }

        return value;
      } catch (error) {
        console.error("Error calling Qwen API:", error);
        alert("Failed to fill field with AI. Please try again or fill manually.");
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

          console.log("Fetching resume for field:", field.key);
          const resumeText = await getResumeFromDB();
          console.log("Resume retrieved, calling AI for field:", field.key);

          await fillFieldWithAI(field, resumeText);
        } catch (error) {
          console.error("Error in AI fill button:", error);
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

      resolve(values);
    });

    // Close on click outside
    modal.addEventListener("click", (e) => {
      if (e.target === modal) {
        document.body.removeChild(modal);
        document.head.removeChild(style);
        resolve({});
      }
    });
  });
}

async function autoFillFields(extractedFields, fieldValues) {
  const missingFields = [];
  const filledValues = {};

  extractedFields.forEach((field) => {
    const value = fieldValues[field.key];
    if (value && value !== "NOTFOUND") {
      filledValues[field.key] = value;
      const element = document.querySelector(field.selector);
      fillInputField(element, value);
    } else {
      missingFields.push(field);
    }
  });

  if (missingFields.length > 0) {
    const manualValues = await promptForMissingValues(missingFields);

    for (const [key, value] of Object.entries(manualValues)) {
      if (value) {
        filledValues[key] = value;
        await saveFieldValue(key, value);
        const field = extractedFields.find((f) => f.key === key);
        if (field) {
          const element = document.querySelector(field.selector);
          fillInputField(element, value);
        }
      }
    }
  }

  return filledValues;
}

async function performAutoApply(resumeData) {
  // Ensure database is ready
  const isReady = await dbReady;
  if (!isReady) {
    throw new Error("Database is not ready. Please refresh the page and try again.");
  }

  const extractedFields = extractFormFields();
  if (!extractedFields.length) {
    throw new Error("No form fields were found on this page.");
  }

  console.log("Resume data received:", resumeData);

  // Use stored resume data to fill fields
  const fieldValues = {};
  extractedFields.forEach((field) => {
    const value = resumeData[field.key];
    if (value && value !== "NOTFOUND") {
      fieldValues[field.key] = value;
    } else {
      fieldValues[field.key] = "NOTFOUND";
    }
  });

  await autoFillFields(extractedFields, fieldValues);
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
      console.error("Auto apply error:", error);
      sendResponse({ success: false, error: error.message || "Auto apply failed." });
    });

  return true;
});

window.addEventListener("load", () => {
  console.log("Content script ready for auto apply.");
});
