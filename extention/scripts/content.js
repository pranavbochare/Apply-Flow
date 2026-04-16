console.log("✅✅✅✅✅✅ Content script loaded");
// Content script to select all input fields, textareas, and labels on the webpage and gather their details
function selectAllInputFields() {
  const inputFields = document.querySelectorAll("input, textarea, label");
  const inputDetails = [];

  inputFields.forEach((input, index) => {
    const details = {
      index: index,
      tagName: input.tagName,
      type: input.type || null,
      id: input.id,
      name: input.name,
      placeholder: input.placeholder || null,
      value: input.value || null,
      className: input.className,
      textContent: input.textContent || null, // For labels
      htmlFor: input.htmlFor || null, // For labels
      attributes: {},
    };

    // Collect all attributes
    for (let attr of input.attributes) {
      details.attributes[attr.name] = attr.value;
    }

    inputDetails.push(details);
  });

  console.log(
    "✅✅✅✅✅✅Selected input fields, textareas, and labels with details:",
    inputDetails,
  );
  return inputDetails;
}

// Function to handle dynamically added elements
function observeDynamicElements() {
  const observer = new MutationObserver((mutations) => {
    let hasNewElements = false;
    mutations.forEach((mutation) => {
      mutation.addedNodes.forEach((node) => {
        if (
          node.nodeType === Node.ELEMENT_NODE &&
          (node.matches("input") || node.matches("textarea") || node.matches("label"))
        ) {
          console.log("New element added:", node);
          hasNewElements = true;
        }
      });
    });
    if (hasNewElements) {
      // Re-run the selection to include new elements
      selectAllInputFields();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

// Example usage: call the function when the page loads or on some event
window.addEventListener("load", () => {
  // Initial selection when page is fully loaded
  selectAllInputFields();
  // Start observing for dynamic elements
  observeDynamicElements();
  // Additional check after a short delay in case some elements are added after load
  setTimeout(() => {
    selectAllInputFields();
  }, 2000);
});
