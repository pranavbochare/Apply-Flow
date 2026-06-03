import * as pdfjsLib from "../libs/pdf.min.mjs";
import {
  saveResumeToIndexedDB,
  getResumeFromIndexedDB,
  getResumeAsFile,
  resumeExistsInIndexedDB,
  deleteResumeFromIndexedDB,
} from "../libs/indexedDB.js";

// Worker path
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("../libs/pdf.worker.min.mjs");

const resumeInput = document.getElementById("resumeUpload");
const messageEl = document.getElementById("message");
const applyBtn = document.getElementById("apply");
const resumeStatusEl = document.getElementById("resumeStatus");

resumeInput.addEventListener("change", () => {
  const file = resumeInput && resumeInput.files && resumeInput.files[0];
  if (file) {
    handleResumeUpload(file);
    return;
  }
});

// Drag and drop functionality
const uploadBox = document.querySelector(".upload-box");
if (uploadBox) {
  uploadBox.addEventListener("dragover", (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadBox.style.background = "#f0f4ff";
    uploadBox.style.borderColor = "#4a7dfc";
  });

  uploadBox.addEventListener("dragleave", (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadBox.style.background = "#fff";
    uploadBox.style.borderColor = "#d0d7e2";
  });

  uploadBox.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    uploadBox.style.background = "#fff";
    uploadBox.style.borderColor = "#d0d7e2";

    const files = e.dataTransfer.files;
    if (files && files.length > 0) {
      const file = files[0];
      if (file.type === "application/pdf" || file.name.endsWith(".pdf")) {
        handleResumeUpload(file);
      } else if (
        file.type.includes("word") ||
        file.type.includes("document") ||
        file.name.endsWith(".doc") ||
        file.name.endsWith(".docx")
      ) {
        handleResumeUpload(file);
      } else if (file.type === "text/plain" || file.name.endsWith(".txt")) {
        handleResumeUpload(file);
      } else {
        showMessage(
          "Please upload a PDF, DOCX, DOC, or TXT file. Resume extraction is optimized for PDFs.",
          true,
        );
      }
    }
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

applyBtn.addEventListener("click", async () => {
  try {
    applyBtn.disabled = true;
    showMessage("Loading resume and preparing to fill form...");

    const settings = await getApiSettings();
    if (!settings.apiKey || !settings.model) {
      throw new Error("API key or model is not configured. Please complete first-time setup.");
    }

    // Get resume from chrome storage
    const resumeData = await new Promise((resolve, reject) => {
      chrome.storage.local.get(["resume"], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error("Failed to retrieve resume from storage"));
        } else if (!result.resume) {
          reject(new Error("No resume found. Please upload your resume first."));
        } else {
          resolve(result.resume);
        }
      });
    });

    // Get the active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });

    if (!tab) {
      throw new Error("No active tab found");
    }

    // Send message to content script to start auto-apply
    chrome.tabs.sendMessage(
      tab.id,
      {
        type: "START_AUTO_APPLY",
        resumeData: resumeData,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          showMessage(
            `Error: ${chrome.runtime.lastError.message}. Make sure you're on a valid job application page.`,
            true,
          );
          applyBtn.disabled = false;
        } else if (response?.success) {
          showMessage(response.message || "Application auto-filled successfully!", false);
          applyBtn.disabled = false;
        } else {
          showMessage(`Error: ${response?.error || "Failed to auto-fill application"}`, true);
          applyBtn.disabled = false;
        }
      },
    );
  } catch (error) {
    showMessage(error.message || "Failed to start auto-apply", true);
    applyBtn.disabled = false;
  }
});

async function handleResumeUpload(file) {
  try {
    const settings = await getApiSettings();
    if (!settings.apiKey || !settings.model) {
      throw new Error("Please save your API key and model before uploading your resume.");
    }

    showMessage("Extracting resume text...");
    const resumeText = await extractTextFromPDF(file);

    if (!resumeText || !resumeText.trim()) {
      throw new Error("Could not extract any text from the resume.");
    }

    showMessage("Sending resume text to the LLM...");
    const resumeJson = await askLLMForResumeJSON(resumeText);

    // Save to Chrome storage (for backward compatibility)
    chrome.storage.local.set({ resume: resumeJson }, () => {
      console.log("Resume saved to Chrome storage");
    });

    // Save file to IndexedDB for automatic file uploads
    await saveResumeToIndexedDB(file, {
      extractedText: resumeText,
      parsedJson: resumeJson,
    });

    showMessage("Resume uploaded successfully and saved to local database.");
  } catch (error) {
    showMessage(error.message || "Resume upload failed.", true);
  }
}

function showMessage(text, isError = false) {
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.style.color = isError ? "#b00020" : "#0b6623";
}

async function extractTextFromPDF(file) {
  const arrayBuffer = await file.arrayBuffer();
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;
  let fullText = "";
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items.map((it) => it.str).join(" ");
    fullText += pageText + "\n\n";
  }
  return fullText.trim();
}

async function askLLMForResumeJSON(resumeText) {
  const { apiKey, model } = await getApiSettings();
  if (!apiKey || !model) {
    throw new Error(
      "API key or model is not configured. Please save your API settings before uploading your resume.",
    );
  }

  const prompt = `Convert the given resume text into a clean structured JSON object. Resume Text: ${resumeText}`;

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
