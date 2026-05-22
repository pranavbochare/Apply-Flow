chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason === "install") {
    chrome.tabs.create({ url: chrome.runtime.getURL("setup.html") });
  }
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "GET_API_SETTINGS") {
    chrome.storage.local.get(["apiKey", "model"], (result) => {
      sendResponse({ apiKey: result.apiKey || "", model: result.model || "" });
    });
    return true;
  }

  if (message?.type === "SET_API_SETTINGS") {
    chrome.storage.local.set({ apiKey: message.apiKey || "", model: message.model || "" }, () => {
      sendResponse({
        success: !chrome.runtime.lastError,
        error: chrome.runtime.lastError?.message,
      });
    });
    return true;
  }
});
