// ============================================================
// FIELD_SELECTOR – matches interactive form elements
// ============================================================
const FIELD_SELECTOR = [
  "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=reset]):not([type=image]):not([type=radio])",
  "textarea",
  "select",
  '[role="combobox"]',
  '[role="listbox"]',
  '[role="searchbox"]',
  '[role="spinbutton"]',
  '[contenteditable=""]',
  '[contenteditable="true"]',
  '[aria-haspopup="listbox"]',
  '[aria-haspopup="menu"]',
  '[aria-haspopup="true"]',
].join(",\n  ");

// ============================================================
// FormFieldExtractor class
// ============================================================
class FormFieldExtractor {
  constructor(options = {}) {
    this.options = {
      includeFilled: false,
      includeHidden: false,
      includeDisabled: false,
      enableLLMFallback: false,
      llmAnalyzer: null,
      ...options,
    };

    this.results = [];
    this.fingerprints = new Set();
    this.usedKeys = new Set();
    this.crossOriginIframes = [];

    this._rootObserver = null;
    this._shadowObservers = [];
    this._observedShadowRoots = new Set();
  }

  extract(root = document) {
    this.results = [];
    this.fingerprints = new Set();
    this.usedKeys = new Set();
    this.crossOriginIframes = [];

    this._walk(root);
    return this.results;
  }

  async extractWithLLMFallback(root = document) {
    const fields = this.extract(root);
    return this._resolveAmbiguousLabels(fields);
  }

  startObserving(callback, { debounceMs = 300 } = {}) {
    this.stopObserving();

    let timeout = null;
    const trigger = () => {
      clearTimeout(timeout);
      timeout = setTimeout(() => callback(this.extract()), debounceMs);
    };

    this._rootObserver = new MutationObserver((mutations) => {
      const relevant = mutations.some(
        (m) =>
          m.addedNodes.length > 0 ||
          m.removedNodes.length > 0 ||
          (m.type === "attributes" &&
            ["style", "class", "disabled", "value", "contenteditable", "hidden"].includes(
              m.attributeName,
            )),
      );
      if (relevant) trigger();
    });

    this._rootObserver.observe(document.documentElement, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class", "disabled", "value", "contenteditable", "hidden"],
    });

    this._attachShadowObservers(document, trigger);
  }

  stopObserving() {
    if (this._rootObserver) this._rootObserver.disconnect();
    this._rootObserver = null;
    this._shadowObservers.forEach((o) => o.disconnect());
    this._shadowObservers = [];
    this._observedShadowRoots = new Set();
  }

  // Async setFieldValue – supports custom dropdowns
  async setFieldValue(el, value, options = {}) {
    const { closeAfterSelect = true, waitForListbox = 2000 } = options;

    if (el.isContentEditable) {
      el.textContent = value;
      el.dispatchEvent(new InputEvent("input", { bubbles: true }));
      return;
    }

    const tag = el.tagName;
    if (tag === "TEXTAREA" || tag === "INPUT") {
      const proto =
        tag === "TEXTAREA"
          ? window.HTMLTextAreaElement.prototype
          : window.HTMLInputElement.prototype;
      const descriptor = Object.getOwnPropertyDescriptor(proto, "value");
      if (descriptor && descriptor.set) {
        descriptor.set.call(el, value);
      } else {
        el.value = value;
      }
      el.dispatchEvent(new Event("input", { bubbles: true }));
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }

    if (tag === "SELECT") {
      const optionsList = Array.from(el.options);
      const targetOption = optionsList.find((opt) => opt.text.trim() === value);
      if (targetOption) {
        el.value = targetOption.value;
        el.dispatchEvent(new Event("change", { bubbles: true }));
      }
      return;
    }

    // Custom dropdown (button with aria-haspopup)
    if (tag === "BUTTON" && el.hasAttribute("aria-haspopup")) {
      el.click();
      await this._wait(100);
      const listbox = await this._findListbox(el, waitForListbox);
      if (!listbox) {
        console.warn("Could not find dropdown listbox for element", el);
        return;
      }
      const optionItems = Array.from(
        listbox.querySelectorAll('[role="option"], li, div[role="option"]'),
      );
      const targetItem = optionItems.find((item) => item.textContent.trim() === value);
      if (!targetItem) {
        console.warn(`Option "${value}" not found in dropdown`, listbox);
        if (closeAfterSelect) el.click();
        return;
      }
      targetItem.click();
      await this._wait(100);
      if (closeAfterSelect) {
        el.click();
      }
      el.dispatchEvent(new Event("change", { bubbles: true }));
    }
  }

  async _findListbox(button, timeout = 2000) {
    const start = Date.now();
    while (Date.now() - start < timeout) {
      const controlsId = button.getAttribute("aria-controls");
      if (controlsId) {
        const root = button.getRootNode();
        const listbox = root.getElementById(controlsId);
        if (listbox && this._isVisible(listbox)) return listbox;
      }
      const parent = button.parentElement;
      if (parent) {
        const listbox = parent.querySelector('[role="listbox"], [role="menu"]');
        if (listbox && this._isVisible(listbox)) return listbox;
        const sibling = button.nextElementSibling;
        if (
          sibling &&
          sibling.matches('[role="listbox"], [role="menu"]') &&
          this._isVisible(sibling)
        ) {
          return sibling;
        }
      }
      const allListboxes = document.querySelectorAll('[role="listbox"], [role="menu"]');
      for (const lb of allListboxes) {
        if (this._isVisible(lb)) {
          const labelledBy = lb.getAttribute("aria-labelledby");
          if (labelledBy && button.id && labelledBy.includes(button.id)) {
            return lb;
          }
        }
      }
      await this._wait(200);
    }
    return null;
  }

  async getFieldOptions(button, timeout = 2000) {
    const isOpen = button.getAttribute("aria-expanded") === "true";
    if (!isOpen) {
      button.click();
      await this._wait(100);
    }
    const listbox = await this._findListbox(button, timeout);
    if (!listbox) return [];
    const items = Array.from(listbox.querySelectorAll('[role="option"], li, div[role="option"]'));
    const texts = items.map((item) => item.textContent.trim()).filter(Boolean);
    if (!isOpen) {
      button.click();
    }
    return texts;
  }

  _wait(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // ---- traversal ----
  _walk(root) {
    const matched = Array.from(root.querySelectorAll(FIELD_SELECTOR));
    this._processElements(matched);
    const all = root.querySelectorAll("*");
    all.forEach((el) => {
      if (el.shadowRoot) {
        this._walk(el.shadowRoot);
      }
      if (el.tagName === "IFRAME") {
        this._walkIframe(el);
      }
    });
  }

  _walkIframe(iframeEl) {
    try {
      const doc = iframeEl.contentDocument;
      if (!doc) return;
      this._walk(doc);
    } catch (e) {
      this.crossOriginIframes.push({
        selector: this._buildSelector(iframeEl),
        src: iframeEl.getAttribute("src") || null,
      });
    }
  }

  _attachShadowObservers(root, trigger) {
    root.querySelectorAll("*").forEach((el) => {
      if (el.shadowRoot && !this._observedShadowRoots.has(el.shadowRoot)) {
        this._observedShadowRoots.add(el.shadowRoot);
        const obs = new MutationObserver(() => trigger());
        obs.observe(el.shadowRoot, { childList: true, subtree: true, attributes: true });
        this._shadowObservers.push(obs);
        this._attachShadowObservers(el.shadowRoot, trigger);
      }
    });
  }

  // ---- processing ----
  _processElements(elements) {
    elements.forEach((el) => {
      if (el.disabled && !this.options.includeDisabled) return;
      if (!this.options.includeFilled && this._hasValue(el)) return;
      if (!this.options.includeHidden && !this._isVisible(el)) return;
      const fp = this._fingerprint(el);
      if (this.fingerprints.has(fp)) return;
      this.fingerprints.add(fp);
      this.results.push(this._buildFieldRecord(el));
    });
  }

  _hasValue(el) {
    if (el.isContentEditable) {
      return (el.textContent || "").trim().length > 0;
    }
    if (el.tagName === "SELECT") return false;
    if (el.tagName === "BUTTON" && el.hasAttribute("aria-haspopup")) {
      const text = (el.textContent || "").trim();
      const placeholder = /select\s+one/i.test(text) || text === "";
      return !placeholder;
    }
    const reactVal = this._getReactValue(el);
    const val = (reactVal ?? el.value ?? "").toString().trim();
    return val.length > 0;
  }

  _buildFieldRecord(el) {
    const label = this._findLabelText(el);
    const locator = this._getElementLocator(el);
    const isDropdown =
      el.tagName === "SELECT" ||
      el.getAttribute("role") === "combobox" ||
      el.getAttribute("role") === "listbox" ||
      (el.tagName === "BUTTON" && el.hasAttribute("aria-haspopup"));

    const baseKey = label.text || el.name || el.id || el.type || el.tagName.toLowerCase();
    const key = this._createUniqueKey(baseKey);

    return {
      key,
      tagName: el.tagName,
      type:
        el.type ||
        (el.isContentEditable ? "contenteditable" : null) ||
        el.getAttribute("role") ||
        null,
      id: el.id || null,
      name: el.name || null,
      placeholder: this._getPlaceholder(el),
      label: label.text || null,
      labelSource: label.source || null,
      labelConfidence: label.text ? (label.source === "placeholder" ? "low" : "high") : "none",
      locator,
      value: this._getCurrentValue(el),
      isDropdown,
      a11y: this._getAccessibilityAttrs(el),
      isReactControlled: !!this._getReactPropsKey(el),
      inShadowDom: locator.shadowHosts.length > 0,
      inIframe: locator.frames.length > 0,
      debugHtmlSnippet: this._safeOuterHtmlSnippet(el),
    };
  }

  _createUniqueKey(base) {
    let key = this._slugify(base) || "field";
    const original = key;
    let i = 1;
    while (this.usedKeys.has(key)) {
      key = `${original}_${i++}`;
    }
    this.usedKeys.add(key);
    return key;
  }

  _slugify(s) {
    return s
      .toString()
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "")
      .slice(0, 60);
  }

  _safeOuterHtmlSnippet(el) {
    try {
      return el.outerHTML.slice(0, 200);
    } catch (e) {
      return null;
    }
  }

  // ---- visibility ----
  _isVisible(el) {
    if (!el || !el.isConnected) return false;
    const style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden" || style.opacity === "0")
      return false;
    if (style.clip === "rect(0px, 0px, 0px, 0px)" || style.clipPath === "inset(100%)") return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 && rect.height === 0) return false;
    if (
      rect.bottom < -window.innerHeight * 5 ||
      rect.top > window.innerHeight * 6 ||
      rect.right < -window.innerWidth * 5 ||
      rect.left > window.innerWidth * 6
    )
      return false;
    return true;
  }

  // ---- label detection (enhanced) ----
  _findLabelText(el) {
    const strategies = [
      ["for-attribute", () => this._getLabelViaForAttribute(el)],
      ["labels-property", () => this._getLabelViaLabelsProperty(el)],
      ["aria-labelledby", () => this._getLabelViaAriaLabelledby(el)],
      ["aria-label", () => el.getAttribute("aria-label")],
      ["data-label", () => el.getAttribute("data-label") || el.getAttribute("data-question")],
      ["mui-wrapper", () => this._getMuiLabel(el)],
      ["antd-wrapper", () => this._getAntdLabel(el)],
      ["form-group", () => this._getFormGroupLabel(el)],
      ["ancestor-sibling-label", () => this._getAncestorSiblingLabel(el)],
      ["table-cell", () => this._getTableCellLabel(el)],
      ["parent-text", () => this._getParentText(el)],
      ["nearby-text", () => this._getNearbyText(el)],
      ["sibling-question", () => this._getSiblingQuestionText(el)],
      ["wellfound-label", () => this._getWellfoundLabel(el)],
      ["ancestor-question", () => this._getAncestorQuestionText(el)],
      ["closest-question", () => this._getClosestQuestionText(el)],
      ["label-sibling", () => this._getLabelSibling(el)],
      ["container-heading", () => this._getContainerHeading(el)],
      ["placeholder", () => this._getPlaceholder(el)],
    ];

    for (const [source, fn] of strategies) {
      let text = null;
      try {
        text = fn();
      } catch (e) {}
      const cleaned = this._cleanLabelText(text);
      if (cleaned) {
        return { text: cleaned, source };
      }
    }
    return { text: null, source: null };
  }

  // ---- new label extraction methods ----
  _getClosestQuestionText(el) {
    let node = el;
    let depth = 0;
    while (node && node.parentElement && depth < 10) {
      const parent = node.parentElement;
      const prevSiblings = Array.from(parent.children).filter((child) => child !== node);
      for (let i = prevSiblings.length - 1; i >= 0; i--) {
        const sib = prevSiblings[i];
        const text = sib.textContent.trim();
        if (text && text.includes("?") && text.length < 200) {
          return text;
        }
      }
      node = parent;
      depth++;
    }
    return null;
  }

  _getLabelSibling(el) {
    let node = el.previousElementSibling;
    while (node) {
      if (node.tagName === "LABEL") {
        return node.textContent.trim();
      }
      const label = node.querySelector("label");
      if (label) return label.textContent.trim();
      node = node.previousElementSibling;
    }
    return null;
  }

  _getContainerHeading(el) {
    const container = el.closest(
      '.question, .field, .form-group, .form-field, [role="group"], fieldset, .MuiFormControl-root, .ant-form-item',
    );
    if (container) {
      const headings = container.querySelectorAll("h1, h2, h3, h4, h5, h6, p, label, span");
      for (const h of headings) {
        if (!h.contains(el) && h.textContent.trim()) {
          const text = h.textContent.trim();
          if (text.length < 200) return text;
        }
      }
      const clone = container.cloneNode(true);
      clone.querySelectorAll("input, select, textarea, button").forEach((n) => n.remove());
      const text = clone.textContent.trim();
      if (text && text.length < 200) return text;
    }
    return null;
  }

  _getWellfoundLabel(el) {
    const selectors = [
      '[data-testid="question"]',
      ".question",
      ".question-text",
      ".form-question",
      ".input-label",
      ".field-label",
      ".label",
      "[data-question]",
      "[aria-label]",
    ];
    const container = el.closest(selectors.join(","));
    if (container) {
      const text = container.textContent.trim();
      if (text) return text;
    }
    return null;
  }

  _getSiblingQuestionText(el) {
    let node = el.previousElementSibling;
    while (node) {
      const text = node.textContent.trim();
      if (text && text.includes("?")) {
        return text;
      }
      const children = node.querySelectorAll("*");
      for (const child of children) {
        const childText = child.textContent.trim();
        if (childText && childText.includes("?")) {
          return childText;
        }
      }
      node = node.previousElementSibling;
    }
    return null;
  }

  _getAncestorQuestionText(el) {
    let ancestor = el.parentElement;
    for (let i = 0; i < 6 && ancestor; i++) {
      const text = ancestor.textContent.trim();
      if (text && text.includes("?") && text.length < 200) {
        return text;
      }
      ancestor = ancestor.parentElement;
    }
    return null;
  }

  // ---- existing label helpers (unchanged) ----
  _cleanLabelText(text) {
    if (!text) return null;
    const collapsed = text.toString().trim().replace(/\s+/g, " ");
    if (!collapsed) return null;
    const withoutRequiredMarker = collapsed
      .replace(/\s*\*\s*$/, "")
      .replace(/\s*\(\s*required\s*\)\s*$/i, "")
      .trim();
    return withoutRequiredMarker || null;
  }

  _getAncestorSiblingLabel(el) {
    let node = el;
    for (let depth = 0; depth < 6 && node && node.parentElement; depth++) {
      const parent = node.parentElement;
      const siblings = Array.from(parent.children);
      for (const sib of siblings) {
        if (sib === node || sib.contains(node)) continue;
        const cls = (sib.className || "").toString();
        const looksLikeLabel =
          sib.tagName === "LABEL" ||
          /(^|[-_ ])label([-_ ]|$)/i.test(cls) ||
          /question[-_ ]?(label|title|text)/i.test(cls);
        if (looksLikeLabel) {
          const text = this._extractCleanElementText(sib);
          if (text) return text;
        }
      }
      node = parent;
    }
    return null;
  }

  _extractCleanElementText(el) {
    const clone = el.cloneNode(true);
    clone
      .querySelectorAll(
        '.required, [class*="required" i], script, style, button, svg, [class*="icon" i], input, select, textarea',
      )
      .forEach((n) => n.remove());
    const text = clone.textContent;
    return text && text.trim() && text.trim().length < 200 ? text.trim() : null;
  }

  _getLabelViaForAttribute(el) {
    if (!el.id) return null;
    const root = el.getRootNode();
    const label = root.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    return label ? label.textContent : null;
  }

  _getLabelViaLabelsProperty(el) {
    if (el.labels && el.labels.length) {
      return Array.from(el.labels)
        .map((l) => l.textContent)
        .join(" ");
    }
    return null;
  }

  _getLabelViaAriaLabelledby(el) {
    const ids = el.getAttribute("aria-labelledby");
    if (!ids) return null;
    const root = el.getRootNode();
    const texts = ids.split(/\s+/).map((id) => {
      const target = root.getElementById ? root.getElementById(id) : document.getElementById(id);
      return target ? target.textContent : "";
    });
    return texts.join(" ").trim();
  }

  _getMuiLabel(el) {
    const wrapper = el.closest(".MuiFormControl-root, .MuiTextField-root");
    if (!wrapper) return null;
    const labelEl = wrapper.querySelector(".MuiInputLabel-root, .MuiFormLabel-root");
    return labelEl ? labelEl.textContent : null;
  }

  _getAntdLabel(el) {
    const wrapper = el.closest(".ant-form-item");
    if (!wrapper) return null;
    const labelEl = wrapper.querySelector(".ant-form-item-label label, .ant-form-item-label");
    return labelEl ? labelEl.textContent : null;
  }

  _getFormGroupLabel(el) {
    const wrapper = el.closest(
      '.form-group, .field, .input-group, [class*="form-field"], [class*="FormField"]',
    );
    if (!wrapper) return null;
    const labelEl = wrapper.querySelector('label, [class*="label" i]');
    if (labelEl && labelEl !== el) return labelEl.textContent;
    return null;
  }

  _getTableCellLabel(el) {
    const cell = el.closest("td, th");
    if (!cell) return null;
    const row = cell.closest("tr");
    const table = cell.closest("table");
    if (!row || !table) return null;
    const cellIndex = Array.from(row.children).indexOf(cell);
    const headerRow = table.querySelector("thead tr") || table.rows[0];
    if (headerRow && headerRow !== row) {
      const headerCell = headerRow.children[cellIndex];
      if (headerCell) return headerCell.textContent;
    }
    if (cellIndex > 0) {
      const prevCell = row.children[cellIndex - 1];
      if (prevCell && !prevCell.querySelector("input, select, textarea")) {
        return prevCell.textContent;
      }
    }
    return null;
  }

  _getParentText(el) {
    const parent = el.parentElement;
    if (!parent) return null;
    const clone = parent.cloneNode(true);
    clone
      .querySelectorAll("input, select, textarea, script, style, button")
      .forEach((n) => n.remove());
    const text = clone.textContent;
    return text && text.trim().length > 0 && text.trim().length < 100 ? text : null;
  }

  _getNearbyText(el) {
    let node = el.previousSibling;
    while (node) {
      if (node.nodeType === Node.TEXT_NODE && node.textContent.trim()) {
        return node.textContent;
      }
      if (node.nodeType === Node.ELEMENT_NODE) {
        const text = node.textContent.trim();
        if (text && text.length < 100 && !node.querySelector("input, select, textarea")) {
          return text;
        }
      }
      node = node.previousSibling;
    }
    return null;
  }

  _getPlaceholder(el) {
    return el.getAttribute("placeholder") || el.getAttribute("aria-placeholder") || null;
  }

  // ---- a11y ----
  _getAccessibilityAttrs(el) {
    const attrs = {};
    Array.from(el.attributes).forEach((a) => {
      if (a.name.startsWith("aria-") || a.name === "role" || a.name === "autocomplete") {
        attrs[a.name] = a.value;
      }
    });
    attrs.required = el.required === true || el.getAttribute("aria-required") === "true" || false;
    attrs.disabled = el.disabled === true || el.getAttribute("aria-disabled") === "true" || false;
    attrs.readonly = el.readOnly === true || el.getAttribute("aria-readonly") === "true" || false;
    return attrs;
  }

  // ---- React ----
  _getReactPropsKey(el) {
    return Object.keys(el).find((k) => k.startsWith("__reactProps$"));
  }

  _getReactFiberKey(el) {
    return Object.keys(el).find(
      (k) => k.startsWith("__reactFiber$") || k.startsWith("__reactInternalInstance$"),
    );
  }

  _getReactValue(el) {
    const propsKey = this._getReactPropsKey(el);
    if (propsKey) {
      const props = el[propsKey];
      if (props && typeof props.value !== "undefined") return props.value;
    }
    return null;
  }

  _getCurrentValue(el) {
    if (el.isContentEditable) return el.textContent.trim() || null;
    if (el.tagName === "SELECT") {
      const opt = el.options[el.selectedIndex];
      return opt ? opt.textContent.trim() : null;
    }
    if (el.tagName === "BUTTON" && el.hasAttribute("aria-haspopup")) {
      const text = (el.textContent || "").trim();
      if (text && !/select\s+one/i.test(text)) {
        return text;
      }
      return el.value || null;
    }
    const reactVal = this._getReactValue(el);
    if (reactVal !== null && typeof reactVal !== "undefined") return reactVal;
    return el.value || null;
  }

  // ---- locators ----
  _buildSelector(el) {
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1) {
      let selector = node.tagName.toLowerCase();
      if (node.id) {
        selector += `#${CSS.escape(node.id)}`;
        parts.unshift(selector);
        break;
      }
      const parent = node.parentNode;
      if (parent && parent.children) {
        const siblings = Array.from(parent.children).filter((s) => s.tagName === node.tagName);
        if (siblings.length > 1) {
          const idx = siblings.indexOf(node) + 1;
          selector += `:nth-of-type(${idx})`;
        }
      }
      parts.unshift(selector);
      if (!parent || parent instanceof ShadowRoot || parent instanceof Document) break;
      node = parent;
    }
    return parts.join(" > ");
  }

  _getElementLocator(el) {
    const shadowHosts = [];
    const frames = [];
    let node = el;
    let root = node.getRootNode();
    while (root instanceof ShadowRoot) {
      shadowHosts.unshift(this._buildSelector(root.host));
      node = root.host;
      root = node.getRootNode();
    }
    let win = el.ownerDocument.defaultView;
    while (win && win !== win.parent) {
      try {
        const frameEl = win.frameElement;
        if (!frameEl) break;
        frames.unshift(this._buildSelector(frameEl));
        win = win.parent;
      } catch (e) {
        break;
      }
    }
    return { frames, shadowHosts, selector: this._buildSelector(el) };
  }

  // ---- fingerprint ----
  _fingerprint(el) {
    const path = this._getDomPath(el);
    const attrs = `${el.tagName}|${el.type || ""}|${el.name || ""}|${el.id || ""}`;
    return this._hashString(`${path}::${attrs}`);
  }

  _getDomPath(el) {
    const parts = [];
    let node = el;
    let depth = 0;
    while (node && node.nodeType === 1 && depth < 25) {
      let part = node.tagName.toLowerCase();
      if (node.id) {
        part += `#${node.id}`;
      } else {
        const parent = node.parentNode;
        if (parent && parent.children) {
          const idx = Array.prototype.indexOf.call(parent.children, node);
          part += `:nth(${idx})`;
        }
      }
      parts.unshift(part);
      const parent = node.parentNode;
      node = parent instanceof ShadowRoot ? parent.host : node.parentElement;
      depth++;
    }
    return parts.join(">");
  }

  _hashString(str) {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      hash = (hash * 31 + str.charCodeAt(i)) | 0;
    }
    return hash.toString(36);
  }

  // ---- LLM fallback ----
  async _resolveAmbiguousLabels(fields) {
    if (!this.options.enableLLMFallback || typeof this.options.llmAnalyzer !== "function") {
      return fields;
    }
    const ambiguous = fields.filter((f) => !f.label || f.labelConfidence === "low");
    if (ambiguous.length === 0) return fields;
    const contexts = ambiguous.map((f) => ({
      key: f.key,
      tag: f.tagName,
      type: f.type,
      name: f.name,
      id: f.id,
      placeholder: f.placeholder,
      htmlSnippet: f.debugHtmlSnippet,
    }));
    try {
      const guesses = await this.options.llmAnalyzer(contexts);
      const guessMap = new Map(guesses.map((g) => [g.key, g]));
      return fields.map((f) => {
        const g = guessMap.get(f.key);
        if (!g) return f;
        return {
          ...f,
          label: f.label || g.guessedLabel,
          labelSource: f.label ? f.labelSource : "llm",
          labelConfidence: f.label ? f.labelConfidence : g.confidence || "medium",
        };
      });
    } catch (e) {
      console.warn("FormFieldExtractor: LLM semantic analysis failed", e);
      return fields;
    }
  }
}

// ============================================================
// Expose globally
// ============================================================
if (typeof window !== "undefined") {
  window.FormFieldExtractor = FormFieldExtractor;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = FormFieldExtractor;
}
