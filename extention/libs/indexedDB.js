// IndexedDB utility for storing and retrieving resume files

const DB_NAME = "ApplyFlowDB";
const DB_VERSION = 1;
const STORE_NAME = "resumes";

let db = null;

/**
 * Initialize IndexedDB database
 */
export function initializeDB() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      console.error("Database failed to open:", request.error);
      reject(new Error("Failed to open IndexedDB database"));
    };

    request.onsuccess = () => {
      db = request.result;
      console.log("Database opened successfully");
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

/**
 * Save resume file to IndexedDB
 * @param {File} file - The resume file
 * @param {Object} metadata - Additional metadata (name, etc.)
 * @returns {Promise<string>} - ID of the saved record
 */
export function saveResumeToIndexedDB(file, metadata = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      if (!db) {
        await initializeDB();
      }

      const reader = new FileReader();

      reader.onload = (e) => {
        const transaction = db.transaction([STORE_NAME], "readwrite");
        const objectStore = transaction.objectStore(STORE_NAME);

        const resumeRecord = {
          id: "default",
          fileName: file.name,
          fileType: file.type,
          fileSize: file.size,
          fileData: e.target.result, // ArrayBuffer
          timestamp: Date.now(),
          ...metadata,
        };

        const request = objectStore.put(resumeRecord);

        request.onerror = () => {
          reject(new Error("Failed to save resume to IndexedDB"));
        };

        request.onsuccess = () => {
          console.log("Resume saved to IndexedDB successfully");
          resolve(resumeRecord.id);
        };
      };

      reader.onerror = () => {
        reject(new Error("Failed to read file"));
      };

      reader.readAsArrayBuffer(file);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Retrieve resume file from IndexedDB
 * @param {string} id - ID of the resume (default: "default")
 * @returns {Promise<Object>} - Resume record with file data
 */
export function getResumeFromIndexedDB(id = "default") {
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

/**
 * Get resume as File object (for file inputs)
 * @param {string} id - ID of the resume (default: "default")
 * @returns {Promise<File>} - File object
 */
export function getResumeAsFile(id = "default") {
  return new Promise(async (resolve, reject) => {
    try {
      const resumeRecord = await getResumeFromIndexedDB(id);

      const blob = new Blob([resumeRecord.fileData], { type: resumeRecord.fileType });
      const file = new File([blob], resumeRecord.fileName, { type: resumeRecord.fileType });

      resolve(file);
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Delete resume from IndexedDB
 * @param {string} id - ID of the resume (default: "default")
 * @returns {Promise<void>}
 */
export function deleteResumeFromIndexedDB(id = "default") {
  return new Promise(async (resolve, reject) => {
    try {
      if (!db) {
        await initializeDB();
      }

      const transaction = db.transaction([STORE_NAME], "readwrite");
      const objectStore = transaction.objectStore(STORE_NAME);
      const request = objectStore.delete(id);

      request.onerror = () => {
        reject(new Error("Failed to delete resume from IndexedDB"));
      };

      request.onsuccess = () => {
        console.log("Resume deleted from IndexedDB successfully");
        resolve();
      };
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Check if a resume exists in IndexedDB
 * @param {string} id - ID of the resume (default: "default")
 * @returns {Promise<boolean>}
 */
export function resumeExistsInIndexedDB(id = "default") {
  return new Promise(async (resolve, reject) => {
    try {
      if (!db) {
        await initializeDB();
      }

      const transaction = db.transaction([STORE_NAME], "readonly");
      const objectStore = transaction.objectStore(STORE_NAME);
      const request = objectStore.get(id);

      request.onerror = () => {
        reject(new Error("Failed to check resume existence"));
      };

      request.onsuccess = () => {
        resolve(!!request.result);
      };
    } catch (error) {
      reject(error);
    }
  });
}

// Initialize database on script load
initializeDB().catch((error) => {
  console.error("Failed to initialize IndexedDB:", error);
});
