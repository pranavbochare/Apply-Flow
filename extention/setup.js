const apiKeyInput = document.getElementById("apiKey");
const modelInput = document.getElementById("model");
const saveButton = document.getElementById("saveButton");
const statusMessage = document.getElementById("statusMessage");

function setStatus(text, isError = false) {
  statusMessage.textContent = text;
  statusMessage.className = isError ? "message error" : "message";
}

saveButton.addEventListener("click", async () => {
  const apiKey = apiKeyInput.value.trim();
  const model = modelInput.value.trim();

  if (!apiKey || !model) {
    setStatus("Both API key and model are required.", true);
    return;
  }

  chrome.storage.local.set({ apiKey, model }, () => {
    if (chrome.runtime.lastError) {
      setStatus("Failed to save settings. Please try again.", true);
      return;
    }

    setStatus("Settings saved successfully! You can now use ApplyFlow.", false);
    saveButton.disabled = true;

    setTimeout(() => {
      window.close();
    }, 1200);
  });
});

chrome.storage.local.get(["apiKey", "model"], (result) => {
  if (result.apiKey) apiKeyInput.value = result.apiKey;
  if (result.model) modelInput.value = result.model;
});
