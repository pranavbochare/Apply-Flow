console.log("🚀 Popup script loaded successfully");

import * as pdfjsLib from "../libs/pdf.min.mjs";

// Worker path
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("../libs/pdf.worker.min.mjs");

const resumeInput = document.getElementById("resumeUpload");
const messageEl = document.getElementById("message");
const applyBtn = document.getElementById("apply");

resumeInput.addEventListener("change", () => {
  console.log("File input changed");
  const file = resumeInput && resumeInput.files && resumeInput.files[0];
  if (file) {
    handleResumeUpload(file);
    return;
  }
});

applyBtn.addEventListener("click", async () => {
  try {
    applyBtn.disabled = true;
    showMessage("Loading resume and preparing to fill form...");

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

    console.log("Resume retrieved from storage:", resumeData);

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
          console.error("Error sending message:", chrome.runtime.lastError);
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
    console.error("Error in apply button:", error);
    showMessage(error.message || "Failed to start auto-apply", true);
    applyBtn.disabled = false;
  }
});

async function handleResumeUpload(file) {
  try {
    showMessage("Extracting resume text...");
    const resumeText = await extractTextFromPDF(file);
    console.log("Extracted Resume Text from handleResumeUpload ------------> : ", resumeText);

    if (!resumeText || !resumeText.trim()) {
      throw new Error("Could not extract any text from the resume.");
    }

    showMessage("Sending resume text to the LLM...");
    const resumeJson = await askLLMForResumeJSON(resumeText);

    console.log("Parsed Resume JSON from LLM ------------> : ", resumeJson);

    chrome.storage.local.set({ resume: resumeJson }, () => {
      showMessage("Resume uploaded successfully.");
    });
  } catch (error) {
    console.error(error);
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
  console.log("Extracted text from PDF --------> ", fullText);
  return fullText.trim();
}

async function askLLMForResumeJSON(resumeText) {
  const prompt = `Convert the given resume text into a clean structured JSON object. Resume Text: ${resumeText}`;

  const resp = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${OPENROUTER_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
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
    console.error("JSON parse error:", err);
    console.error("Invalid JSON text:", jsonText);

    throw new Error("Failed to parse LLM JSON response.");
  }
}
