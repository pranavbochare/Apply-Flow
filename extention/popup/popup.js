const messageEl = document.getElementById("message");
const applyBtn = document.getElementById("apply");

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
    applyBtn.classList.add("is-loading");
    const buttonLabel = applyBtn.querySelector(".button-label");
    if (buttonLabel) {
      buttonLabel.textContent = "Working...";
    }
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

    const profileData = await new Promise((resolve, reject) => {
      chrome.storage.local.get(["profileData"], (result) => {
        if (chrome.runtime.lastError) {
          reject(new Error("Failed to retrieve profileData from storage"));
        } else if (!result.profileData) {
          reject(new Error("No profileData found."));
        } else {
          resolve(result.profileData);
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
        profileData: profileData,
      },
      (response) => {
        if (chrome.runtime.lastError) {
          showMessage("Make sure you're on a valid job application page. Please try again", true);
          applyBtn.disabled = false;
          applyBtn.classList.remove("is-loading");
          if (buttonLabel) {
            buttonLabel.textContent = "Start Auto Apply";
          }
        } else if (response?.success) {
          showMessage("Application auto-filled successfully!", false);
          applyBtn.disabled = false;
          applyBtn.classList.remove("is-loading");
          if (buttonLabel) {
            buttonLabel.textContent = "Start Auto Apply";
          }
        } else {
          showMessage("Failed to auto-fill application. Please try again", true);
          applyBtn.disabled = false;
          applyBtn.classList.remove("is-loading");
          if (buttonLabel) {
            buttonLabel.textContent = "Start Auto Apply";
          }
        }
      },
    );
  } catch (error) {
    showMessage("Failed to start auto-apply, Please try again", true);
    applyBtn.disabled = false;
    applyBtn.classList.remove("is-loading");
    if (applyBtn.querySelector(".button-label")) {
      applyBtn.querySelector(".button-label").textContent = "Start Auto Apply";
    }
  }
});

function showMessage(text, isError = false) {
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.style.color = isError ? "#b00020" : "#0b6623";
}

async function updateSupportStatusDisplay() {
  const el = document.getElementById("support-status");
  if (!el) return;

  try {
    // Get the currently active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) {
      el.textContent = "⏳ No active tab";
      el.style.background = "#f0f4ff";
      el.style.color = "#1a3a6b";
      return;
    }

    // Ask background for this tab's support status
    const response = await chrome.runtime.sendMessage({
      type: "GET_SUPPORT_STATUS",
      tabId: tab.id,
    });

    const status = response?.status;

    if (!status) {
      el.textContent = "⏳ Checking support...";
      el.style.background = "#f0f4ff";
      el.style.color = "#1a3a6b";
      return;
    }

    if (status.supported) {
      el.textContent = "supported on this page";
      el.style.background = "#e8f5e9";
      el.style.color = "#1e5e2e";
    } else {
      el.textContent = "Not supported on this page";
      el.style.background = "#fbe9e7";
      el.style.color = "#8d2e1c";
    }
  } catch (err) {
    el.textContent = "⚠️ Error loading status";
    el.style.background = "#fff3cd";
    el.style.color = "#856404";
  }
}

// Update when popup opens
document.addEventListener("DOMContentLoaded", updateSupportStatusDisplay);
