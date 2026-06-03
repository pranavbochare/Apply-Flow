// IndexedDB setup and handlers
const DB_NAME = "ApplyFlowDB";
const DB_VERSION = 1;
const STORE_NAME = "resumes";

let db = null;

function initializeDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("Database failed to open:", request.error);
      reject(new Error("Failed to open IndexedDB database"));
    };

    request.onsuccess = () => {
      db = request.result;
      console.log("Background: Database opened successfully");
      resolve(db);
    };

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        const objectStore = database.createObjectStore(STORE_NAME, { keyPath: "id" });
        objectStore.createIndex("name", "name", { unique: false });
        objectStore.createIndex("timestamp", "timestamp", { unique: false });
        console.log("Object store created");
      }
    };
  });
}

function getResumeFromIndexedDB(id = "default") {
  return new Promise(async (resolve, reject) => {
    try {
      if (!db) {
        await initializeDB();
      }

      const transaction = db.transaction([STORE_NAME], "readonly");
      const objectStore = transaction.objectStore(STORE_NAME);
      const request = objectStore.get(id);

      request.onerror = () => {
        reject(new Error("Failed to retrieve resume from IndexedDB"));
      };

      request.onsuccess = () => {
        if (request.result) {
          resolve(request.result);
        } else {
          reject(new Error("No resume found in IndexedDB"));
        }
      };
    } catch (error) {
      reject(error);
    }
  });
}

// Initialize database on startup
initializeDB().catch((error) => {
  console.error("Failed to initialize IndexedDB in background:", error);
});

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

  if (message?.type === "GET_RESUME_FROM_IDB") {
    getResumeFromIndexedDB()
      .then((resumeRecord) => {
        // Convert ArrayBuffer to a format that can be sent through message passing
        const fileDataArray = Array.from(new Uint8Array(resumeRecord.fileData));
        sendResponse({
          success: true,
          file: {
            fileName: resumeRecord.fileName,
            fileType: resumeRecord.fileType,
            fileData: fileDataArray,
          },
        });
      })
      .catch((error) => {
        sendResponse({
          success: false,
          error: error.message || "Failed to retrieve resume from IndexedDB",
        });
      });
    return true;
  }
});
