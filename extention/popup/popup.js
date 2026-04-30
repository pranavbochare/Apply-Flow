console.log("Popup script loaded");

// Database will be initialized inside DOMContentLoaded
let db;
let dbReady = Promise.resolve(false);

document.addEventListener("DOMContentLoaded", async () => {
  console.log("DOM loaded, initializing popup...");

  // Initialize IndexedDB inside DOMContentLoaded
  db = new Dexie("ApplyFlowDB");
  db.version(1).stores({
    resumes: "id, name, createdAt",
    fieldValues: "key",
  });

  // Open database and create the ready promise
  dbReady = db
    .open()
    .then(() => {
      console.log("✅ IndexedDB opened successfully");
      return true;
    })
    .catch((error) => {
      console.error("❌ Failed to open IndexedDB:", error);
      return false;
    });

  // Wait for database to be ready before initializing UI
  const isDbReady = await dbReady;
  if (!isDbReady) {
    console.error("Database failed to initialize. Some features may not work.");
  }

  console.log("DOM and Database initialization complete");
  const fileInput = document.getElementById("resumeUpload");
  const messageDiv = document.getElementById("message");
  const uploadBox = document.querySelector(".upload-box");
  const applyButton = document.getElementById("apply");

  console.log("Elements found:", { fileInput, messageDiv, uploadBox, applyButton });

  function setMessage(text) {
    messageDiv.textContent = text;
  }

  async function extractResumeText(base64) {
    const [_, data] = base64.split(",");

    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);

    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const pdf = await pdfjsLib.getDocument({ data: bytes }).promise;

    let text = "";

    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();

      text += content.items.map((item) => item.str).join(" ") + "\n";
    }

    return text.replace(/\s+/g, " ").trim();
  }

  async function storeResume(file, fileData) {
    try {
      console.log("🔄 Processing resume for storage...", {
        fileName: file.name,
        fileSize: fileData.length,
        fileType: file.type,
      });

      // Show loading message
      setMessage("⏳ Processing resume file... This may take a moment for PDFs.");

      // Extract text from the file
      let resumeText;
      try {
        resumeText = getResumeText(fileData);
        console.log("✅ Resume text extracted successfully. Length:", resumeText);
        console.log("✅ Resume file processed successfully");
      } catch (textExtractionError) {
        console.error("❌ Failed to process resume file:", textExtractionError.message);
        setMessage(`❌ ${textExtractionError.message}`);
        return;
      }

      let extractedData;
      try {
        // Use LLM to extract structured data
        console.log("🤖 Calling LLM to extract resume data...");
        setMessage("🤖 Analyzing resume with AI...");
        extractedData = await extractResumeData(resumeText);
        console.log("✅ LLM extraction successful:", extractedData);
      } catch (extractionError) {
        console.error("⚠️ LLM extraction failed:", extractionError.message);
        setMessage(`❌ Failed to parse resume: ${extractionError.message}`);
        return;
      }

      // Ensure database is ready before storing
      console.log("⏳ Waiting for database to be ready...");
      const dbIsReady = await dbReady;
      if (!dbIsReady) {
        throw new Error("Database is not ready. Cannot store resume.");
      }
      console.log("✅ Database is ready");

      // Show saving message
      setMessage("💾 Saving resume to database...");

      // Store the extracted object in IndexedDB
      console.log("💾 Storing resume object in IndexedDB...");
      try {
        const result = await db.resumes.put({
          id: "default",
          name: file.name,
          data: extractedData,
          createdAt: new Date().toISOString(),
        });
        console.log("✅ Resume stored successfully with result:", result);
      } catch (putError) {
        console.error("❌ Error during put operation:", putError);
        throw putError;
      }

      // Verify the resume was actually stored
      console.log("🔍 Verifying stored data...");
      try {
        const storedResume = await db.resumes.get("default");
        console.log("✅ Verification - Resume retrieved from DB:", {
          id: storedResume?.id,
          name: storedResume?.name,
          dataKeys: storedResume?.data ? Object.keys(storedResume.data) : [],
          createdAt: storedResume?.createdAt,
        });

        if (!storedResume) {
          throw new Error("Resume was not stored in the database");
        }
      } catch (verifyError) {
        console.error("❌ Error during verification:", verifyError);
        throw verifyError;
      }

      setMessage("✅ Resume uploaded and processed successfully!");
      console.log("✅ Complete: Resume successfully stored and verified");
    } catch (error) {
      console.error("❌ Error storing resume:", error.message);
      setMessage(`❌ ${error.message}`);
    }
  }

  async function extractResumeData(resumeText) {
    const isBase64Encoded = resumeText.includes("BASE64_ENCODED_FILE");
    const fileType = resumeText.includes("FILE_TYPE:")
      ? resumeText.split("\n")[0].replace("FILE_TYPE:", "")
      : "TEXT";

    let prompt;

    if (isBase64Encoded) {
      // For binary files (PDF, DOCX, etc), provide specialized instructions
      prompt = `You are a professional resume parser that can handle documents in multiple formats (PDF, DOCX, Word, etc.).

IMPORTANT: The resume data below is base64-encoded because it's a binary file (${fileType} format).

YOUR TASK:
1. Decode and parse the base64-encoded file content
2. Extract ALL relevant information from the decoded resume document
3. Return ONLY a valid JSON object with the fields below

CRITICAL INSTRUCTIONS:
- Return ONLY valid JSON (no markdown, no code blocks, no text)
- Use the exact key names specified
- If a field is not found, use "NOTFOUND"
- Handle any formatting from PDF/DOCX extraction (may contain unusual spacing or characters)
- Normalize values (trim whitespace, clean special characters)
- For multi-value fields (skills, languages), use comma-separated format

REQUIRED JSON KEYS:
{
  "firstName": "first name",
  "lastName": "last name",
  "fullName": "complete full name",
  "email": "email address",
  "phone": "phone number",
  "location": "city, state/country",
  "address": "full address",
  "linkedin": "LinkedIn URL or username",
  "github": "GitHub URL or username",
  "portfolio": "portfolio website",
  "summary": "professional summary (max 200 chars)",
  "experience": "job titles and companies (comma-separated)",
  "education": "degree, field, institution (comma-separated)",
  "degree": "highest degree (Bachelor's, Master's, etc.)",
  "college": "college/university name",
  "skills": "technical and professional skills (comma-separated)",
  "languages": "languages spoken (comma-separated)",
  "certifications": "professional certifications (comma-separated)",
  "achievements": "key achievements or awards (comma-separated)",
  "projects": "notable projects with descriptions"
}

BASE64-ENCODED ${fileType} RESUME:
${resumeText}

Extract the information and return ONLY the JSON object.`;
    } else {
      // For plain text files
      prompt = `You are a professional resume parser. Your task is to extract structured information from the resume text below.

IMPORTANT INSTRUCTIONS:
1. Carefully read through the entire resume text
2. Extract ALL relevant information
3. Return ONLY a valid JSON object (no markdown, no code blocks, no explanations)
4. Use the exact key names specified below
5. If information is not found, use "NOTFOUND"
6. Clean and normalize all values (trim whitespace, remove special characters where needed)
7. For skills/languages, use comma-separated values
8. For dates, keep the original format from resume

REQUIRED JSON KEYS TO EXTRACT:
{
  "firstName": "first name or initials",
  "lastName": "last name",
  "fullName": "complete full name",
  "email": "email address",
  "phone": "phone number",
  "location": "city, state/country",
  "address": "full address if available",
  "linkedin": "LinkedIn profile URL or username",
  "github": "GitHub profile URL or username",
  "portfolio": "portfolio website URL",
  "summary": "professional summary or objective (max 200 chars)",
  "experience": "job titles and companies (comma-separated)",
  "education": "degree, field of study, institution",
  "degree": "highest degree (e.g., Bachelor's, Master's)",
  "college": "college/university name",
  "skills": "technical and professional skills (comma-separated)",
  "languages": "languages spoken (comma-separated)",
  "certifications": "professional certifications (comma-separated)",
  "achievements": "key achievements or awards (comma-separated)",
  "projects": "notable projects with brief descriptions"
}

PARSING GUIDELINES:
- Look for sections like: SUMMARY, EXPERIENCE, EDUCATION, SKILLS, CERTIFICATIONS, PROJECTS
- Handle different date formats and resume layouts
- If multiple formats exist, choose the most complete/recent
- Infer missing fields from context (e.g., derive firstName from fullName if needed)
- For phone numbers, keep the format as-is in the resume
- For URLs, keep them complete with protocol if available

RESUME TEXT:
---START OF RESUME---
${resumeText}
---END OF RESUME---

Return ONLY the JSON object with no additional text or markdown.`;
    }

    console.log("🤖 Sending resume to LLM for parsing...");
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.3, // Lower temperature for more consistent parsing
      }),
    });

    if (!response.ok) {
      throw new Error(`API request failed: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();
    console.log("API response received:", data);

    const outputText = data?.choices?.[0]?.message?.content || "";
    console.log("📝 LLM raw output:\n", outputText);

    // Extract JSON from response (handle cases where LLM adds extra text)
    const firstBrace = outputText.indexOf("{");
    const lastBrace = outputText.lastIndexOf("}");
    if (firstBrace === -1 || lastBrace === -1) {
      console.error("❌ Cannot find JSON in response:", outputText);
      throw new Error("LLM did not return valid JSON. Response: " + outputText.substring(0, 200));
    }

    const jsonText = outputText.slice(firstBrace, lastBrace + 1);
    console.log("✅ Extracted JSON:\n", jsonText);

    let parsed;
    try {
      parsed = JSON.parse(jsonText);
      console.log("✅ Successfully parsed JSON:", parsed);
    } catch (parseError) {
      console.error("❌ Failed to parse JSON:", parseError, "\nJSON text:", jsonText);
      throw new Error("Failed to parse LLM response: " + parseError.message);
    }

    return parsed;
  }

  function getResumeText(resumeBase64) {
    if (!resumeBase64.startsWith("data:")) return resumeBase64;

    const [mime, data] = resumeBase64.split(",");
    let text = "";

    console.log("📄 Processing file with MIME type:", mime);

    // Handle text files - decode directly
    if (mime.includes("text/") || mime.includes("plain")) {
      try {
        text = atob(data);
        // Clean up the text
        text = text
          .replace(/\r\n/g, "\n") // Normalize line endings
          .replace(/\n\n\n+/g, "\n\n") // Remove excessive blank lines
          .trim();
        console.log("✅ Text file decoded successfully");
      } catch (e) {
        console.error("Failed to decode text file:", e);
        throw new Error("Failed to parse resume file as text.");
      }
    }
    // Handle PDF files - send base64 to LLM for extraction
    else if (mime.includes("application/pdf")) {
      console.log("📑 PDF file detected - sending to LLM for text extraction");
      // For PDF, we'll send it as base64 with special instruction
      text = `FILE_TYPE:PDF\nBASE64_ENCODED_FILE:\n${resumeBase64}`;
    }
    // Handle DOCX files - send base64 to LLM for extraction
    else if (mime.includes("application/vnd.openxmlformats") || mime.includes("wordprocessingml")) {
      console.log("📘 DOCX file detected - sending to LLM for text extraction");
      text = `FILE_TYPE:DOCX\nBASE64_ENCODED_FILE:\n${resumeBase64}`;
    }
    // Handle other document formats
    else if (
      mime.includes("application/msword") ||
      mime.includes("application/vnd.ms-word") ||
      mime.includes("application/rtf")
    ) {
      console.log("📄 Document file detected - sending to LLM for text extraction");
      text = `FILE_TYPE:DOCUMENT\nBASE64_ENCODED_FILE:\n${resumeBase64}`;
    }
    // Handle any other file type - try to send as base64
    else {
      console.log("❓ Unknown file type - attempting to process as document");
      text = `FILE_TYPE:UNKNOWN\nMIME:${mime}\nBASE64_ENCODED_FILE:\n${resumeBase64}`;
    }

    // Ensure we have meaningful content
    if (!text || text.length < 20) {
      throw new Error("Resume file is empty or too small. Please upload a valid resume.");
    }

    // Truncate to reasonable length for API (but allow longer for binary data markers)
    const MAX_LENGTH = 15000; // Increased to handle base64 encoded files
    if (text.length > MAX_LENGTH) {
      console.warn(`Resume file truncated from ${text.length} to ${MAX_LENGTH} characters`);
      text = text.substring(0, MAX_LENGTH) + "\n...[File truncated due to length]";
    }

    console.log("📄 Resume file prepared:", {
      fileType: mime,
      length: text.length,
      isBase64: text.includes("BASE64_ENCODED_FILE"),
    });

    return text;
  }

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

    setMessage("");

    const reader = new FileReader();
    reader.onload = async function () {
      await storeResume(file, reader.result);
    };

    reader.readAsDataURL(file);
  });

  fileInput.addEventListener("change", async (event) => {
    console.log("File selected");
    const file = event.target.files[0];
    if (!file) return;

    setMessage("");

    const reader = new FileReader();
    reader.onload = async function () {
      await storeResume(file, reader.result);
    };

    reader.readAsDataURL(file);
  });

  applyButton.addEventListener("click", async () => {
    setMessage("");
    console.log("Start Auto-Apply Jobs clicked");

    console.log("⏳ Waiting for database to be ready...");
    await dbReady;
    console.log("✅ Database is ready");

    try {
      const existingResume = await db.resumes.get("default");
      console.log("📦 Retrieved resume from DB:", {
        found: !!existingResume,
        hasData: !!existingResume?.data,
        dataKeys: existingResume?.data ? Object.keys(existingResume.data) : [],
      });

      if (!existingResume || !existingResume.data) {
        setMessage("❌ Please upload your resume before auto-applying.");
        return;
      }

      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const activeTab = tabs[0];

      if (!activeTab?.id) {
        setMessage("❌ Unable to find the active tab.");
        return;
      }

      const response = await chrome.tabs.sendMessage(activeTab.id, {
        type: "START_AUTO_APPLY",
        resumeData: existingResume.data,
      });

      if (response?.success) {
        setMessage(response.message || "✅ Auto apply flow completed successfully.");
      } else {
        setMessage(`❌ Auto apply failed: ${response?.error || "unknown error"}`);
      }
    } catch (error) {
      console.error("❌ Failed to start auto apply:", error);
      setMessage("❌ Failed to start auto apply. Make sure the page is ready and try again.");
    }
  });
});
