import * as pdfjsLib from "./libs/pdf.min.mjs";

import {
  saveResumeToIndexedDB,
  getResumeFromIndexedDB,
  getResumeAsFile,
  resumeExistsInIndexedDB,
  deleteResumeFromIndexedDB,
} from "./libs/indexedDB.js";

// Worker path
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("./libs/pdf.worker.min.mjs");

const profileFields = {
  firstName: "",
  middleName: "",
  lastName: "",
  email: "",
  phone: "",
  phoneCountryCode: "",
  gender: "",
  hasExperience: "",

  country: "",
  state: "",
  city: "",
  address: "",
  postalCode: "",

  linkedinUrl: "",
  githubUrl: "",
  portfolioUrl: "",

  degree: "",
  specialization: "",
  institution: "",
  graduationYear: "",
  cgpa: "",

  currentCompany: "",
  currentTitle: "",
  currentlyWorking: "",
  expectedSalary: "",
  noticePeriod: "",

  preferredLocation: "",
  preferredWorkMode: "",
  willingToRelocate: "",
  requiresSponsorship: "",
};

const resumeInput = document.getElementById("resumeUpload");
const messageEl = document.getElementById("message");
const resumeStatusEl = document.getElementById("resumeStatus");
const saveProfileBtn = document.getElementById("saveProfileBtn");
const loadingOverlay = document.getElementById("setupLoadingOverlay");
const loadingTitleEl = document.getElementById("setupLoadingTitle");
const loadingSubtitleEl = document.getElementById("setupLoadingSubtitle");

let countryOptions = [];
let countryCodeOptions = [];
let statesCache = new Map();
let citiesCache = new Map();

async function fetchJson(url, options = {}) {
  const response = await fetch(url, options);
  if (!response.ok) {
    throw new Error(`Request failed: ${response.status}`);
  }
  return response.json();
}

async function loadCountryAndPhoneOptions() {
  if (countryOptions.length && countryCodeOptions.length) {
    return;
  }

  try {
    const countriesData = await fetchJson(
      "https://raw.githubusercontent.com/mledoze/countries/master/dist/countries.json",
    );

    countryOptions = (Array.isArray(countriesData) ? countriesData : [])
      .map((country) => {
        const name = country?.name?.common || "";
        return name ? { value: name, label: name } : null;
      })
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label));

    countryCodeOptions = (Array.isArray(countriesData) ? countriesData : [])
      .map((country) => {
        const name = country?.name?.common || "";
        const code = country?.callingCodes?.[0] || country?.idd?.root || "";

        if (!name || !code) {
          return null;
        }

        const normalizedCode = code.startsWith("+") ? code : `+${code}`;
        return { value: normalizedCode, label: `${name} ${normalizedCode}` };
      })
      .filter(Boolean)
      .sort((a, b) => a.label.localeCompare(b.label));
  } catch (error) {
    console.error("Failed to load country dropdown data:", error);
    countryOptions = [];
    countryCodeOptions = [];
  }
}

async function loadStatesForCountry(countryName) {
  if (!countryName) {
    return [];
  }

  if (statesCache.has(countryName)) {
    return statesCache.get(countryName);
  }

  try {
    const data = await fetchJson("https://countriesnow.space/api/v0.1/countries/states", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: countryName }),
    });

    const states = (data?.data?.states || []).map((state) => state.name).filter(Boolean);
    statesCache.set(countryName, states);
    return states;
  } catch (error) {
    console.error(`Failed to load states for ${countryName}:`, error);
    return [];
  }
}

async function loadCitiesForCountryAndState(countryName, stateName) {
  if (!countryName || !stateName) {
    return [];
  }

  const cacheKey = `${countryName}::${stateName}`;
  if (citiesCache.has(cacheKey)) {
    return citiesCache.get(cacheKey);
  }

  try {
    const data = await fetchJson("https://countriesnow.space/api/v0.1/countries/state/cities", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ country: countryName, state: stateName }),
    });

    const cities = (data?.data || []).filter(Boolean);
    citiesCache.set(cacheKey, cities);
    return cities;
  } catch (error) {
    console.error(`Failed to load cities for ${countryName}/${stateName}:`, error);
    return [];
  }
}

function createSelectElement(id, placeholder, options, selectedValue = "") {
  const select = document.createElement("select");
  select.id = id;
  select.name = id;

  const defaultOption = document.createElement("option");
  defaultOption.value = "";
  defaultOption.textContent = placeholder;
  select.appendChild(defaultOption);

  options.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    if (option.value === selectedValue) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });

  return select;
}

function populateSelectOptions(select, options, placeholderText, selectedValue = "") {
  select.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = placeholderText;
  select.appendChild(placeholder);

  options.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.value;
    opt.textContent = option.label;
    if (option.value === selectedValue) {
      opt.selected = true;
    }
    select.appendChild(opt);
  });
}

async function populateCountrySelect(countrySelect, selectedValue = "") {
  await loadCountryAndPhoneOptions();
  populateSelectOptions(countrySelect, countryOptions, "Select Country", selectedValue);
}

async function populateStateSelect(countryValue, stateSelect, selectedValue = "") {
  stateSelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select State";
  stateSelect.appendChild(placeholder);

  if (!countryValue) {
    return;
  }

  const states = await loadStatesForCountry(countryValue);
  states.forEach((state) => {
    const option = document.createElement("option");
    option.value = state;
    option.textContent = state;
    if (state === selectedValue) {
      option.selected = true;
    }
    stateSelect.appendChild(option);
  });
}

async function populateCitySelect(countryValue, stateValue, citySelect, selectedValue = "") {
  citySelect.innerHTML = "";

  const placeholder = document.createElement("option");
  placeholder.value = "";
  placeholder.textContent = "Select City";
  citySelect.appendChild(placeholder);

  if (!countryValue || !stateValue) {
    return;
  }

  const cities = await loadCitiesForCountryAndState(countryValue, stateValue);
  cities.forEach((city) => {
    const option = document.createElement("option");
    option.value = city;
    option.textContent = city;
    if (city === selectedValue) {
      option.selected = true;
    }
    citySelect.appendChild(option);
  });
}

function clearEmploymentDetails() {
  const fields = [
    "currentCompany",
    "currentTitle",
    "currentlyWorking",
    "expectedSalary",
    "noticePeriod",
  ];

  fields.forEach((fieldId) => {
    const element = document.getElementById(fieldId);
    if (element) {
      element.value = "";
    }
  });
}

function toggleEmploymentSection() {
  const hasExperienceSelect = document.getElementById("hasExperience");
  const employmentHeading = document.getElementById("employmentHeading");
  const employmentDetails = document.getElementById("employmentDetails");

  if (!hasExperienceSelect || !employmentHeading || !employmentDetails) {
    return;
  }

  const shouldShow = hasExperienceSelect.value === "Yes";
  employmentHeading.style.display = shouldShow ? "block" : "none";
  employmentDetails.style.display = shouldShow ? "block" : "none";

  if (!shouldShow) {
    clearEmploymentDetails();
  }
}

function setupEmploymentExperienceToggle() {
  const hasExperienceSelect = document.getElementById("hasExperience");

  if (!hasExperienceSelect) {
    return;
  }

  hasExperienceSelect.addEventListener("change", toggleEmploymentSection);
  toggleEmploymentSection();
}

async function initializeDynamicLocationAndPhoneControls() {
  const countryInput = document.getElementById("country");
  const stateInput = document.getElementById("state");
  const cityInput = document.getElementById("city");
  const phoneInput = document.getElementById("phone");

  await loadCountryAndPhoneOptions();

  if (countryInput && stateInput && cityInput) {
    const countrySelect = document.createElement("select");
    countrySelect.id = "country";
    countrySelect.name = "country";
    await populateCountrySelect(countrySelect, countryInput.value || "");

    const stateSelect = document.createElement("select");
    stateSelect.id = "state";
    stateSelect.name = "state";

    const citySelect = document.createElement("select");
    citySelect.id = "city";
    citySelect.name = "city";

    countryInput.replaceWith(countrySelect);
    stateInput.replaceWith(stateSelect);
    cityInput.replaceWith(citySelect);

    const initialCountry = countryInput.value || countrySelect.value || "";
    if (initialCountry) {
      await populateStateSelect(initialCountry, stateSelect, stateInput.value || "");
      const initialState = stateInput.value || stateSelect.value || "";
      if (initialState) {
        await populateCitySelect(initialCountry, initialState, citySelect, cityInput.value || "");
      }
    } else {
      await populateStateSelect("", stateSelect, "");
      await populateCitySelect("", "", citySelect, "");
    }

    countrySelect.addEventListener("change", async () => {
      const selectedCountry = countrySelect.value;
      await populateStateSelect(selectedCountry, stateSelect, "");
      await populateCitySelect(selectedCountry, "", citySelect, "");
    });

    stateSelect.addEventListener("change", async () => {
      await populateCitySelect(countrySelect.value, stateSelect.value, citySelect, "");
    });
  }

  if (phoneInput) {
    const phoneField = phoneInput.closest(".field");
    if (phoneField) {
      const phoneGroup = document.createElement("div");
      phoneGroup.style.display = "flex";
      phoneGroup.style.gap = "10px";
      phoneGroup.style.alignItems = "center";

      const phoneCodeSelect = createSelectElement(
        "phoneCountryCode",
        "Code",
        countryCodeOptions,
        phoneInput.dataset.countryCode || "",
      );
      phoneCodeSelect.style.flex = "0 0 140px";
      phoneCodeSelect.style.width = "140px";
      phoneCodeSelect.style.minWidth = "140px";

      phoneInput.style.flex = "1";
      phoneInput.style.width = "100%";

      phoneInput.parentNode.insertBefore(phoneGroup, phoneInput);
      phoneGroup.appendChild(phoneCodeSelect);
      phoneGroup.appendChild(phoneInput);
    }
  }
}

async function syncLocationDropdowns(countryValue = "", stateValue = "", cityValue = "") {
  const countrySelect = document.getElementById("country");
  const stateSelect = document.getElementById("state");
  const citySelect = document.getElementById("city");

  if (!countrySelect || !stateSelect || !citySelect) {
    return;
  }

  await populateCountrySelect(countrySelect, countryValue || countrySelect.value || "");
  await populateStateSelect(
    countrySelect.value,
    stateSelect,
    stateValue || stateSelect.value || "",
  );
  await populateCitySelect(
    countrySelect.value,
    stateSelect.value,
    citySelect,
    cityValue || citySelect.value || "",
  );
}

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

resumeInput.addEventListener("change", () => {
  const file = resumeInput && resumeInput.files && resumeInput.files[0];
  if (file) {
    handleResumeUpload(file);
    return;
  }
});

function showMessage(text, isError = false) {
  if (!messageEl) return;
  messageEl.textContent = text;
  messageEl.style.color = isError ? "#b00020" : "#0b6623";
}

function setLoadingState(
  isLoading,
  title = "Saving your setup",
  subtitle = "Please wait while everything is being prepared.",
) {
  if (!loadingOverlay || !saveProfileBtn) return;

  loadingOverlay.classList.toggle("show", isLoading);
  loadingOverlay.setAttribute("aria-hidden", String(!isLoading));
  saveProfileBtn.disabled = isLoading;
  saveProfileBtn.classList.toggle("is-loading", isLoading);

  if (loadingTitleEl) {
    loadingTitleEl.textContent = title;
  }

  if (loadingSubtitleEl) {
    loadingSubtitleEl.textContent = subtitle;
  }
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

async function getApiSettings() {
  const apiKey = document.getElementById("apiKey")?.value?.trim() || "";
  const model = document.getElementById("model")?.value?.trim() || "";

  if (apiKey || model) {
    await chrome.storage.local.set({
      apiKey,
      model,
    });
  }

  const result = await chrome.storage.local.get(["apiKey", "model"]);

  return {
    apiKey: result.apiKey || "",
    model: result.model || "",
  };
}

async function fillProfileForm(profileData) {
  Object.entries(profileData).forEach(([fieldId, value]) => {
    const element = document.getElementById(fieldId);

    if (!element) return;

    let finalValue = "";

    if (value === null || value === undefined) {
      finalValue = "";
    } else if (typeof value === "object") {
      if (Array.isArray(value)) {
        finalValue = value.join(", ");
      } else {
        finalValue = JSON.stringify(value);
      }
    } else {
      finalValue = String(value);
    }

    element.value = finalValue;

    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  });

  await syncLocationDropdowns(
    document.getElementById("country")?.value || "",
    document.getElementById("state")?.value || "",
    document.getElementById("city")?.value || "",
  );
}

async function handleResumeUpload(file) {
  try {
    setLoadingState(true, "Uploading your resume", "Extracting and parsing resume data...");

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
    const resumeJson = await askLLMForResumeJSON(resumeText, profileFields);

    const resumeData = resumeJson.resumeData || {};
    const profileData = resumeJson.profileData || {};

    chrome.storage.local.set({ resume: resumeData }, () => {
      console.log("Resume saved to Chrome storage");
    });

    await saveResumeToIndexedDB(file, {
      extractedText: resumeText,
      parsedJson: resumeData,
    });

    showMessage("Resume uploaded successfully.");

    fillProfileForm(profileData);
  } catch (error) {
    showMessage("Resume upload failed. Please try again.", true);
  } finally {
    setLoadingState(false);
  }
}

async function askLLMForResumeJSON(resumeText, profileFields) {
  const { apiKey, model } = await getApiSettings();
  if (!apiKey || !model) {
    throw new Error(
      "API key or model is not configured. Please save your API settings before uploading your resume.",
    );
  }

  const prompt = `
Extract information from the resume and return ONLY valid JSON.

Resume:
${resumeText}

Return JSON in exactly this format:

{
  "resumeData": Convert the given resume text into a clean structured JSON object,
  "profileData": {
    ${Object.keys(profileFields)
      .map((key) => `"${key}": ""`)
      .join(",\n")}
  }
}

Rules:
1. resumeData should contain the complete structured resume.
2. profileData should contain values only for the specified fields from the resumeText.
3. If a field is not found, return an empty string.
4. Return ONLY JSON.
5. Do not include markdown.
6. Do not include explanations.
`;

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

function loadProfile() {
  chrome.storage.local.get(["profileData"], (result) => {
    const profileData = result.profileData || {};

    Object.entries(profileData).forEach(([key, value]) => {
      const element = document.getElementById(key);

      if (element) {
        element.value = value || "";
      }
    });

    setupEmploymentExperienceToggle();
    toggleEmploymentSection();

    void syncLocationDropdowns(
      document.getElementById("country")?.value || "",
      document.getElementById("state")?.value || "",
      document.getElementById("city")?.value || "",
    );
  });
}

function saveProfile() {
  const profileData = {};

  Object.keys(profileFields).forEach((key) => {
    const element = document.getElementById(key);

    if (element) {
      profileData[key] = element.value?.trim() || "";
    }
  });

  const status = document.getElementById("statusMessage");

  const error = validateProfile(profileData);
  if (error) {
    if (status) {
      status.textContent = error;
      status.style.color = "red";
    }
    return;
  }

  setLoadingState(
    true,
    "Saving your profile",
    "Please wait while your setup is being stored securely.",
  );

  chrome.storage.local.set(
    {
      profileData,
      setupCompleted: true,
    },
    () => {
      if (chrome.runtime.lastError) {
        if (status) {
          status.textContent = "Failed to save profile.";
          status.style.color = "red";
        }
        setLoadingState(false);
        return;
      }

      if (status) {
        status.textContent = "Profile saved successfully.";
        status.style.color = "green";
      }

      // Keep the loader visible briefly so the save action feels consistent
      setTimeout(() => {
        setLoadingState(false);
        window.close();
      }, 900);
    },
  );
}

saveProfileBtn?.addEventListener("click", saveProfile);

setupEmploymentExperienceToggle();

initializeDynamicLocationAndPhoneControls().then(() => {
  loadProfile();
});

function validateProfile(profileData) {
  // All fields required
  for (const field of Object.keys(profileFields)) {
    if (!profileData[field]?.trim() && field !== "portfolioUrl" && field !== "phoneCountryCode") {
      return `${field} is required`;
    }
  }

  // Email
  if (profileData.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(profileData.email)) {
    return "Invalid email address";
  }

  // Phone
  if (profileData.phone && !/^\+?[0-9]{10,15}$/.test(profileData.phone.replace(/\s/g, ""))) {
    return "Invalid phone number";
  }

  // LinkedIn
  if (profileData.linkedinUrl && !profileData.linkedinUrl.includes("linkedin.com")) {
    return "Invalid LinkedIn URL";
  }

  // GitHub
  if (profileData.githubUrl && !profileData.githubUrl.includes("github.com")) {
    return "Invalid GitHub URL";
  }

  // Graduation Year
  if (profileData.graduationYear && !/^\d{4}$/.test(profileData.graduationYear)) {
    return "Graduation Year must be a 4-digit year";
  }

  // CGPA
  if (profileData.cgpa) {
    const cgpa = Number(profileData.cgpa);

    if (isNaN(cgpa) || cgpa < 0 || cgpa > 10) {
      return "CGPA must be between 0 and 10";
    }
  }

  // Postal Code
  if (profileData.postalCode && !/^[a-zA-Z0-9\s-]{4,10}$/.test(profileData.postalCode)) {
    return "Invalid Postal Code";
  }

  // Dropdown validations
  if (!["Male", "Female", "Other", "Prefer not to say"].includes(profileData.gender)) {
    return "Please select a valid Gender";
  }

  if (!["Yes", "No"].includes(profileData.currentlyWorking)) {
    return "Please select Currently Working";
  }

  if (
    !["Immediate", "15 Days", "30 Days", "45 Days", "60 Days", "90 Days"].includes(
      profileData.noticePeriod,
    )
  ) {
    return "Please select a valid Notice Period";
  }

  if (!["Remote", "Hybrid", "Onsite"].includes(profileData.preferredWorkMode)) {
    return "Please select a valid Work Mode";
  }

  if (!["Yes", "No"].includes(profileData.willingToRelocate)) {
    return "Please select Relocation Preference";
  }

  if (!["Yes", "No"].includes(profileData.requiresSponsorship)) {
    return "Please select Sponsorship Requirement";
  }

  return null; // Validation passed
}
