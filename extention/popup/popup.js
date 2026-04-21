console.log("Popup script loaded");

// Initialize IndexedDB
const db = new Dexie("ApplyFlowDB");

db.version(1).stores({
  resumes: "id, name, createdAt",
});

document.addEventListener("DOMContentLoaded", () => {
  console.log("DOM loaded, initializing upload handlers");
  // Get file input
  const fileInput = document.getElementById("resumeUpload");
  const messageDiv = document.getElementById("message");
  const uploadBox = document.querySelector(".upload-box");

  console.log("Elements found:", { fileInput, messageDiv, uploadBox });

  // Drag and drop functionality
  uploadBox.addEventListener("dragover", (e) => {
    console.log("Drag over");
    e.preventDefault();
    uploadBox.style.borderColor = "#4a7dfc";
  });

  uploadBox.addEventListener("dragleave", () => {
    console.log("Drag leave");
    uploadBox.style.borderColor = "#d0d7e2";
  });

  uploadBox.addEventListener("drop", async (e) => {
    console.log("File dropped");
    e.preventDefault();
    uploadBox.style.borderColor = "#d0d7e2";

    const file = e.dataTransfer.files[0];
    if (!file) return;

    // Clear previous message
    messageDiv.textContent = "";

    // Check if resume already exists
    const existingResume = await db.resumes.get("default");
    console.log("Existing resume:", existingResume);

    if (existingResume) {
      messageDiv.textContent = "Resume is already uploaded. No need to upload again.";
      return;
    }

    const reader = new FileReader();

    reader.onload = async function () {
      const fileData = reader.result;

      // Store in IndexedDB
      await db.resumes.put({
        id: "default", // for now only one resume
        name: file.name,
        file: fileData,
        createdAt: new Date(),
      });
      console.log("Resume stored in DB");

      messageDiv.textContent = "Resume uploaded successfully!";
    };

    // Convert file to base64
    reader.readAsDataURL(file);
  });

  // When user selects file
  fileInput.addEventListener("change", async (event) => {
    console.log("File selected");
    const file = event.target.files[0];

    if (!file) return;

    // Clear previous message
    messageDiv.textContent = "";

    // Check if resume already exists
    const existingResume = await db.resumes.get("default");
    console.log("Existing resume:", existingResume);

    if (existingResume) {
      messageDiv.textContent = "Resume is already uploaded. No need to upload again.";
      return;
    }

    const reader = new FileReader();

    reader.onload = async function () {
      const fileData = reader.result;

      // Store in IndexedDB
      await db.resumes.put({
        id: "default", // for now only one resume
        name: file.name,
        file: fileData,
        createdAt: new Date(),
      });
      console.log("Resume stored in DB");

      messageDiv.textContent = "Resume uploaded successfully!";
    };

    // Convert file to base64
    reader.readAsDataURL(file);
  });
});
