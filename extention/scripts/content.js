// ============================================================
// FIELD_SELECTOR – includes custom dropdown buttons
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
// FormFieldExtractor – enhanced label detection
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
    // FIX for Indeed: treat text inputs with role=combobox but no aria-haspopup as normal fields
    const isDropdown =
      el.tagName === "SELECT" ||
      el.getAttribute("role") === "listbox" ||
      (el.tagName === "BUTTON" && el.hasAttribute("aria-haspopup")) ||
      // For combobox role: only if it has aria-haspopup OR it's not a plain text input
      (el.getAttribute("role") === "combobox" &&
        (el.hasAttribute("aria-haspopup") || el.tagName !== "INPUT" || el.type !== "text"));

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
      ".question, .field, .form-group, .form-field, [role='group'], fieldset, .MuiFormControl-root, .ant-form-item",
    );
    if (container) {
      const headings = container.querySelectorAll("h1,h2,h3,h4,h5,h6,p,label,span");
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

  // ---- existing label helpers ----
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
// Expose FormFieldExtractor globally
// ============================================================
if (typeof window !== "undefined") {
  window.FormFieldExtractor = FormFieldExtractor;
}
if (typeof module !== "undefined" && module.exports) {
  module.exports = FormFieldExtractor;
}

// ============================================================
// Content Script Main Functions
// ============================================================

// ---- create floating bot ----
function createFloatingBot() {
  if (document.getElementById("autoapply-bot")) return;
  const bot = document.createElement("div");
  bot.id = "autoapply-bot";
  bot.innerHTML = `
  <img
    src="${chrome.runtime.getURL("../images/bot5.png")}"
    alt="ApplyFlow Bot"
    id="bot-image"
  />
`;
  document.body.appendChild(bot);
  makeDraggable(bot);
  bot.addEventListener("click", () => {
    toggleSidebar();
  });
}

// ---- sidebar ----
function getOrCreateSidebar() {
  let sidebar = document.getElementById("autoapply-sidebar");
  if (sidebar) return sidebar;
  sidebar = document.createElement("div");
  sidebar.id = "autoapply-sidebar";
  sidebar.innerHTML = `
      <iframe
          id="autoapply-frame"
          src="${chrome.runtime.getURL("popup/popup.html")}"
      ></iframe>
  `;
  const chatbotSizing = {
    position: "fixed",
    bottom: "24px",
    right: "24px",
    top: "auto",
    left: "auto",
    width: "380px",
    height: "620px",
    "max-height": "80vh",
    "border-radius": "18px",
    overflow: "hidden",
    "box-shadow": "0 18px 45px rgba(15, 23, 42, 0.25)",
    "z-index": "2147483000",
  };
  Object.entries(chatbotSizing).forEach(([prop, value]) => {
    sidebar.style.setProperty(prop, value, "important");
  });
  document.body.appendChild(sidebar);
  const frame = sidebar.querySelector("#autoapply-frame");
  if (frame) {
    frame.style.setProperty("width", "100%", "important");
    frame.style.setProperty("height", "100%", "important");
    frame.style.setProperty("border", "none", "important");
    frame.style.setProperty("display", "block", "important");
  }
  return sidebar;
}

function toggleSidebar() {
  const existing = document.getElementById("autoapply-sidebar");
  if (existing) {
    existing.remove();
    return;
  }
  getOrCreateSidebar();
}

// ---- global styles ----
function injectAutoApplyGlobalStyles() {
  if (document.getElementById("aa-global-style")) return;
  const style = document.createElement("style");
  style.id = "aa-global-style";
  style.textContent = `
    .aa-sidebar-loader {
      position: absolute;
      top: 78px;
      right: 0;
      bottom: 0;
      left: 0;
      background: rgba(255, 255, 255, 0.97);
      z-index: 30;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      animation: aaFadeIn 0.2s ease-out;
    }
    .aa-sidebar-loader.aa-hidden {
      display: none !important;
      pointer-events: none;
    }
    .aa-sidebar-loader-card {
      padding: 24px 28px;
      background: white;
      border-radius: 16px;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.14);
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 12px;
      max-width: 80%;
      text-align: center;
    }
    .aa-sidebar-loader-ring {
      width: 40px;
      height: 40px;
      border-radius: 50%;
      border: 4px solid rgba(59, 97, 255, 0.15);
      border-top-color: #3b64ff;
      animation: aaRingSpin 0.9s linear infinite;
    }
    .aa-sidebar-loader-text {
      color: #22303c;
      font-weight: 600;
      font-size: 13px;
      line-height: 1.4;
    }
    @keyframes aaFadeIn {
      from { opacity: 0; transform: translateY(8px); }
      to { opacity: 1; transform: translateY(0); }
    }
    @keyframes aaRingSpin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
  `;
  document.head.appendChild(style);
}

function getOrCreateSidebarLoader() {
  injectAutoApplyGlobalStyles();
  const sidebar = getOrCreateSidebar();
  let loader = sidebar.querySelector("#aa-sidebar-loader");
  if (loader) return loader;
  loader = document.createElement("div");
  loader.id = "aa-sidebar-loader";
  loader.className = "aa-sidebar-loader aa-hidden";
  loader.innerHTML = `
    <div class="aa-sidebar-loader-card">
      <div class="aa-sidebar-loader-ring"></div>
      <div class="aa-sidebar-loader-text">Loading...</div>
    </div>
  `;
  sidebar.appendChild(loader);
  return loader;
}

function showSidebarLoader(message) {
  const loader = getOrCreateSidebarLoader();
  loader.querySelector(".aa-sidebar-loader-text").textContent = message;
  loader.classList.remove("aa-hidden");
}

function updateSidebarLoader(message) {
  const sidebar = document.getElementById("autoapply-sidebar");
  const loader = sidebar?.querySelector("#aa-sidebar-loader");
  if (loader) loader.querySelector(".aa-sidebar-loader-text").textContent = message;
}

function hideSidebarLoader() {
  const sidebar = document.getElementById("autoapply-sidebar");
  const loader = sidebar?.querySelector("#aa-sidebar-loader");
  if (loader) loader.classList.add("aa-hidden");
}

// ---- draggable ----
function makeDraggable(element) {
  let isDragging = false;
  let offsetX = 0;
  let offsetY = 0;
  element.addEventListener("mousedown", (e) => {
    isDragging = true;
    const rect = element.getBoundingClientRect();
    offsetX = e.clientX - rect.left;
    offsetY = e.clientY - rect.top;
    element.style.left = rect.left + "px";
    element.style.top = rect.top + "px";
    element.style.right = "auto";
    e.preventDefault();
  });
  document.addEventListener("mousemove", (e) => {
    if (!isDragging) return;
    let x = e.clientX - offsetX;
    let y = e.clientY - offsetY;
    const maxX = window.innerWidth - element.offsetWidth;
    const maxY = window.innerHeight - element.offsetHeight;
    x = Math.max(0, Math.min(x, maxX));
    y = Math.max(0, Math.min(y, maxY));
    element.style.left = x + "px";
    element.style.top = y + "px";
  });
  document.addEventListener("mouseup", () => {
    isDragging = false;
  });
}

// ---- API settings ----
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

// ---- label helpers ----
function findLabelText(element) {
  if (!element) return null;
  if (element.id) {
    const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`);
    if (label?.innerText) return label.innerText.trim();
  }
  const parentLabel = element.closest("label");
  if (parentLabel?.innerText) return parentLabel.innerText.trim();
  return null;
}

function createElementKey(base, index, usedKeys) {
  let key = base || `field_${index}`;
  let suffix = 1;
  while (usedKeys.has(key)) {
    key = `${base || `field_${index}`}_${suffix}`;
    suffix += 1;
  }
  usedKeys.add(key);
  return key;
}

function getActualPlaceholder(element) {
  const placeholder = element.getAttribute("placeholder")?.trim();
  if (placeholder) return placeholder;
  const ariaLabel = element.getAttribute("aria-label")?.trim();
  if (ariaLabel) return ariaLabel;
  const title = element.getAttribute("title")?.trim();
  if (title) return title;
  const label = findLabelText(element);
  if (label) return label;
  return null;
}

// ---- build applicant context ----
function buildApplicantContext(resumeData, profileData) {
  const toText = (data) => {
    if (!data) return "";
    if (typeof data === "string") return data.trim();
    try {
      return JSON.stringify(data, null, 2).trim();
    } catch (e) {
      return "";
    }
  };
  const resumeText = toText(resumeData);
  const profileText = toText(profileData);
  const sections = [];
  if (resumeText) {
    sections.push(`RESUME:\n${resumeText}`);
  }
  if (profileText) {
    sections.push(
      `PROFILE INFORMATION (saved user profile — prefer this for contact details, links, location, and questions the resume doesn't cover; the resume is the primary source for work history, skills, and experience):\n${profileText}`,
    );
  }
  return sections.join("\n\n");
}

function getProfileValueForField(profileData, field) {
  if (!profileData || typeof profileData !== "object") return null;
  return (
    profileData[field.key] ?? profileData[field.placeholder] ?? profileData[field.label] ?? null
  );
}

// ---- extract form fields (wrapper) ----
function extractFormFields() {
  const extractor = new FormFieldExtractor({
    includeFilled: false,
    includeDisabled: true,
  });
  const fields = extractor.extract(document);
  return fields.map((f) => ({
    key: f.key,
    tagName: f.tagName,
    type: f.type,
    id: f.id,
    name: f.name,
    placeholder: f.placeholder,
    label: f.label,
    selector: f.locator.selector,
    locator: f.locator,
    value: f.value,
    isDropdown: f.isDropdown,
  }));
}

// ---- radio groups ----
function extractRadioGroups() {
  const allRadios = Array.from(document.querySelectorAll('input[type="radio"]:not([disabled])'));
  if (!allRadios.length) return [];
  const namedGroups = {};
  const unnamedRadios = [];
  allRadios.forEach((radio) => {
    if (radio.name) {
      if (!namedGroups[radio.name]) namedGroups[radio.name] = [];
      namedGroups[radio.name].push(radio);
    } else {
      unnamedRadios.push(radio);
    }
  });
  const groups = [];
  Object.entries(namedGroups).forEach(([name, radios]) => {
    const alreadyChecked = radios.some((r) => r.checked);
    const groupLabel = findRadioGroupLabel(radios) || name;
    const options = radios.map((radio) => {
      const label =
        findLabelText(radio) ||
        radio.value ||
        radio.getAttribute("aria-label") ||
        radio.id ||
        radio.value;
      return {
        el: radio,
        value: radio.value,
        label: label.trim(),
        selector: getElementSelector(radio),
      };
    });
    groups.push({
      name,
      groupLabel,
      options,
      alreadyChecked,
      selector: getElementSelector(radios[0]),
    });
  });
  return groups;
}

function findRadioGroupLabel(radios) {
  if (!radios.length) return null;
  const fieldset = radios[0].closest("fieldset");
  if (fieldset) {
    const legend = fieldset.querySelector("legend");
    if (legend?.innerText) return legend.innerText.trim();
  }
  let ancestor = radios[0].parentElement;
  for (let i = 0; i < 6; i++) {
    if (!ancestor) break;
    const labelledBy = ancestor.getAttribute("aria-labelledby");
    if (labelledBy) {
      const labelEl = document.getElementById(labelledBy);
      if (labelEl?.innerText) return labelEl.innerText.trim();
    }
    const ariaLabel = ancestor.getAttribute("aria-label");
    if (ariaLabel) return ariaLabel.trim();
    ancestor = ancestor.parentElement;
  }
  const container = radios[0].closest("div, section, li, p") || radios[0].parentElement;
  if (container) {
    const prev = container.previousElementSibling;
    if (prev) {
      const text = prev.innerText?.trim();
      if (text && text.length < 120) return text;
    }
    const headings = container.querySelectorAll("h1,h2,h3,h4,h5,h6,label,p,span");
    for (const h of headings) {
      if (!h.contains(radios[0]) && h.innerText?.trim()) {
        return h.innerText.trim();
      }
    }
  }
  return null;
}

async function getRadioChoiceFromLLM(groupLabel, options, applicantContext) {
  const { apiKey, model } = await getApiSettings();
  const optionLabels = options.map((o) => o.label);
  const prompt = `
You are filling out a job application form.
Question / Field: "${groupLabel}"
Available radio options:
${optionLabels.join(", ")}
Based on the applicant data below (resume and/or profile), return ONLY one exact option from the available options above.
No explanation. No punctuation. No extra text. Just the option label exactly as written.
Applicant data:
${applicantContext}
  `.trim();
  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: prompt }],
      temperature: 0,
    }),
  });
  const data = await response.json();
  const chosen = data?.choices?.[0]?.message?.content?.trim();
  if (!chosen) {
    console.warn(`LLM returned empty for radio group "${groupLabel}"`);
    return null;
  }
  return chosen;
}

async function fillRadioGroup(group, applicantContext) {
  try {
    if (group.alreadyChecked) return;
    if (!group.options.length) {
      console.warn(`No options for radio group "${group.groupLabel}"`);
      return;
    }
    let chosenLabel = await getRadioChoiceFromLLM(
      group.groupLabel,
      group.options,
      applicantContext,
    );
    chosenLabel = chosenLabel?.trim()?.replace(/^["'`\s]+|["'`\s]+$/g, "");
    if (!chosenLabel) return;
    const matched =
      group.options.find((o) => o.label.toLowerCase() === chosenLabel.toLowerCase()) ??
      group.options.find((o) => o.label.toLowerCase().includes(chosenLabel.toLowerCase())) ??
      group.options.find((o) => chosenLabel.toLowerCase().includes(o.label.toLowerCase()));
    if (!matched) {
      console.warn(`No radio option matched "${chosenLabel}" for "${group.groupLabel}"`);
      return;
    }
    const radioEl =
      matched.el ||
      document.querySelector(matched.selector) ||
      document.querySelector(
        `input[type="radio"][name="${CSS.escape(group.name)}"][value="${CSS.escape(matched.value)}"]`,
      );
    if (!radioEl) {
      console.warn(`Could not find radio DOM element for "${matched.label}"`);
      return;
    }
    radioEl.focus();
    radioEl.click();
    radioEl.dispatchEvent(new Event("change", { bubbles: true }));
    radioEl.dispatchEvent(new Event("input", { bubbles: true }));
    const associatedLabel =
      radioEl.closest("label") ||
      document.querySelector(`label[for="${CSS.escape(radioEl.id || "")}"]`);
    if (associatedLabel && associatedLabel !== radioEl) {
      associatedLabel.click();
    }
    await sleep(150);
  } catch (err) {
    console.error(`Error filling radio group "${group.groupLabel}":`, err);
  }
}

function getElementSelector(element) {
  if (!element) return null;
  const path = [];
  let node = element;
  while (node && node.nodeType === Node.ELEMENT_NODE && node !== document.body) {
    let selector = node.nodeName.toLowerCase();
    if (node.id) {
      selector += `#${CSS.escape(node.id)}`;
      path.unshift(selector);
      break;
    }
    const siblingIndex =
      Array.from(node.parentNode.children)
        .filter((sibling) => sibling.nodeName === node.nodeName)
        .indexOf(node) + 1;
    selector += siblingIndex > 1 ? `:nth-of-type(${siblingIndex})` : "";
    path.unshift(selector);
    node = node.parentNode;
  }
  return path.join(" > ");
}

// ---- LLM for free-text fields ----
function extractJsonFromText(text) {
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace === -1 || lastBrace === -1) {
    throw new Error("No JSON object found in Gemini response.");
  }
  return text.slice(firstBrace, lastBrace + 1);
}

async function callGeminiApi(payload) {
  const prompt = `
You are an AI resume/profile parser.

Your task is to extract values from the applicant data based ONLY on the provided fields.

Instructions:
- The input field names are provided in "FIELDS TO EXTRACT".
- Create a JSON object where:
  - key = field name from "FIELDS TO EXTRACT"
  - value = matching information found in the applicant data (resume and/or profile)
- Prefer the profile section for contact details, links, and location; prefer the resume for work history, skills, and experience.
- If a value is not found in either, return "NOTFOUND".
- Do not create extra fields.
- Do not rename fields.
- Return ONLY raw JSON.
- No explanations, no markdown, no code block.

FIELDS TO EXTRACT:
${payload.fields.map((field) => field.key).join(", ")}

APPLICANT DATA:
${payload.context}
`;
  const { apiKey, model } = await getApiSettings();
  if (!apiKey || !model) {
    throw new Error(
      "API key or model is not configured. Please open the extension popup and save your API settings.",
    );
  }
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

// ---- field finding and filling ----
function findFieldElement(field) {
  if (!field) return null;
  if (field.selector) {
    const element = document.querySelector(field.selector);
    if (element) return element;
  }
  if (field.id) {
    const byId = document.getElementById(field.id);
    if (byId) return byId;
  }
  if (field.name) {
    const byName = document.querySelector(`[name="${CSS.escape(field.name)}"]`);
    if (byName) return byName;
  }
  if (field.placeholder) {
    const byPlaceholder = document.querySelector(
      `input[placeholder="${CSS.escape(field.placeholder)}"], textarea[placeholder="${CSS.escape(field.placeholder)}"]`,
    );
    if (byPlaceholder) return byPlaceholder;
  }
  if (field.label) {
    const labels = Array.from(document.querySelectorAll("label"));
    const matchingLabel = labels.find(
      (labelEl) => labelEl.innerText.trim().toLowerCase() === field.label.trim().toLowerCase(),
    );
    if (matchingLabel) {
      const fieldId = matchingLabel.getAttribute("for");
      if (fieldId) {
        const byLabelFor = document.getElementById(fieldId);
        if (byLabelFor) return byLabelFor;
      }
    }
  }
  return null;
}

function fillInputField(element, value) {
  if (!element) return;
  element.focus();
  element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

// ---- Helper: generate user‑friendly label and placeholder ----
function getDisplayLabelAndPlaceholder(field) {
  // Start with the best available label
  let label = field.label || field.placeholder || field.name || field.id || field.key || "Field";

  // If label looks like an ID (underscores, no spaces, starts with custom/field/question), try placeholder
  const isIdLike =
    /^custom|^question|^field_|^input_|^text_|^select_/i.test(label) ||
    (label.includes("_") && !label.includes(" "));
  const placeholder = field.placeholder && field.placeholder.trim();
  if (isIdLike && placeholder && placeholder.includes(" ")) {
    label = placeholder;
  }

  // Clean up: replace underscores and camelCase with spaces
  label = label
    .replace(/_/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .trim();
  // Capitalize first letter
  label = label.charAt(0).toUpperCase() + label.slice(1);

  // For the placeholder, use the actual placeholder if available, otherwise generate contextual
  let placeholderText = placeholder || "";
  if (!placeholderText) {
    const type = field.type || "";
    const lowerLabel = label.toLowerCase();
    if (type === "email" || lowerLabel.includes("email")) {
      placeholderText = "e.g., you@example.com";
    } else if (
      type === "tel" ||
      type === "phone" ||
      lowerLabel.includes("phone") ||
      lowerLabel.includes("mobile")
    ) {
      placeholderText = "e.g., +1 234 567 8900";
    } else if (type === "number" || lowerLabel.includes("number") || lowerLabel.includes("age")) {
      placeholderText = "e.g., 10";
    } else if (type === "date" || lowerLabel.includes("date") || lowerLabel.includes("birth")) {
      placeholderText = "e.g., 2024-12-31";
    } else if (
      type === "url" ||
      lowerLabel.includes("linkedin") ||
      lowerLabel.includes("website")
    ) {
      placeholderText = "e.g., https://linkedin.com/in/yourprofile";
    } else if (lowerLabel.includes("name")) {
      placeholderText = "e.g., John Doe";
    } else if (lowerLabel.includes("city") || lowerLabel.includes("location")) {
      placeholderText = "e.g., New York";
    } else {
      placeholderText = `Enter ${label}`;
    }
  }
  return { displayLabel: label, placeholderText: placeholderText };
}

// ---- prompt for missing values ----
async function promptForMissingValues(missingFields, profileData) {
  return new Promise((resolve) => {
    const sidebar = getOrCreateSidebar();
    sidebar.querySelector(".aa-inline-modal")?.remove();

    const style = document.createElement("style");
    style.textContent = `
      .aa-inline-modal {
        position: absolute;
        top: 78px;
        right: 0;
        bottom: 0;
        left: 0;
        background: linear-gradient(135deg, #ffffff 0%, #f8f9fa 100%);
        z-index: 20;
        display: flex;
        flex-direction: column;
        overflow: hidden;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        animation: aaFadeIn 0.2s ease-out;
        box-shadow: 0 -8px 20px rgba(15, 23, 42, 0.08);
      }
      @keyframes aaFadeIn {
        from { opacity: 0; transform: translateY(8px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .aa-inline-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 18px 18px 4px;
      }
      .aa-inline-modal-header h3 {
        margin: 0;
        color: #2c3e50;
        font-size: 17px;
        font-weight: 700;
      }
      .aa-inline-modal-close {
        border: none;
        background: #f1f3f5;
        color: #495057;
        width: 28px;
        height: 28px;
        border-radius: 50%;
        font-size: 18px;
        line-height: 1;
        cursor: pointer;
      }
      .aa-inline-modal-close:hover { background: #e9ecef; }
      .aa-inline-modal-subtitle {
        margin: 6px 18px 16px;
        color: #6c757d;
        font-size: 13px;
      }
      .aa-inline-modal-form {
        padding: 0 18px 18px;
        display: flex;
        flex-direction: column;
        flex: 1;
        min-height: 0;
        overflow-y: auto;
        gap: 4px;
        position: relative;
        z-index: 5;
        scrollbar-width: none;
        -ms-overflow-style: none;
      }
      .aa-inline-modal-form::-webkit-scrollbar {
        display: none;
      }
      .aa-form-field { margin-bottom: 14px; }
      .aa-form-field label {
        display: block;
        margin-bottom: 6px;
        font-weight: 600;
        color: #2c3e50;
        font-size: 13px;
      }
      .aa-form-field input {
        width: 100%;
        padding: 10px 12px;
        border: 2px solid #e1e8ed;
        border-radius: 8px;
        font-size: 14px;
        box-sizing: border-box;
      }
      .aa-form-field input:focus {
        outline: none;
        border-color: #007bff;
        box-shadow: 0 0 0 3px rgba(0, 123, 255, 0.1);
      }
      .aa-field-wrapper { display: flex; align-items: flex-end; gap: 6px; }
      .aa-field-wrapper > .aa-form-field { flex: 1; margin-bottom: 14px; }
      .aa-ai-fill-btn {
        padding: 9px 10px;
        background: linear-gradient(135deg, #6c63ff 0%, #5a47d4 100%);
        color: white;
        border: none;
        border-radius: 8px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        white-space: nowrap;
        margin-bottom: 14px;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        transition: all 0.2s ease;
        z-index: 5;
      }
      .aa-ai-fill-btn:hover:not(.loading) { transform: scale(1.05); }
      .aa-ai-fill-btn.loading {
        opacity: 0.9;
        cursor: not-allowed;
      }
      .aa-ai-btn-spinner {
        display: none;
        width: 12px;
        height: 12px;
        flex: none;
        border-radius: 50%;
        border: 2px solid rgba(255, 255, 255, 0.4);
        border-top-color: #ffffff;
        animation: aaInlineSpin 0.7s linear infinite;
      }
      .aa-ai-fill-btn.loading .aa-ai-btn-spinner {
        display: inline-block;
      }
      .aa-ai-btn-label {
        line-height: 1;
      }
      .aa-submit-btn {
        margin-top: auto;
        position: sticky;
        bottom: 0;
        width: 100%;
        padding: 14px;
        background: linear-gradient(135deg, #2563eb 0%, #1d4ed8 100%);
        color: white;
        border: none;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 700;
        cursor: pointer;
        transition: all 0.3s ease;
        box-shadow: 0 -4px 12px rgba(37, 99, 235, 0.15), 0 4px 12px rgba(37, 99, 235, 0.3);
        z-index: 5;
      }
      .aa-submit-btn:hover:not(.loading) { 
        transform: translateY(-2px);
        box-shadow: 0 -4px 12px rgba(37, 99, 235, 0.15), 0 6px 16px rgba(37, 99, 235, 0.4);
      }
      .aa-submit-btn:active:not(.loading) { 
        transform: translateY(0);
      }
      .aa-submit-btn.loading {
        opacity: 0.75;
        cursor: not-allowed;
      }
      .aa-submit-btn.loading::before {
        content: "";
        position: absolute;
        top: 50%;
        left: 50%;
        width: 18px;
        height: 18px;
        border-radius: 50%;
        border: 3px solid rgba(255, 255, 255, 0.55);
        animation: aaButtonSpinner 0.9s linear infinite;
        z-index: 10;
      }
      .aa-submit-btn.loading {
        color: transparent;
      }
      @keyframes aaButtonSpinner {
        from { transform: translate(-50%, -50%) rotate(0deg); }
        to { transform: translate(-50%, -50%) rotate(360deg); }
      }
      @keyframes aaInlineSpin {
        from { transform: rotate(0deg); }
        to { transform: rotate(360deg); }
      }
    `;
    document.head.appendChild(style);

    const modal = document.createElement("div");
    modal.className = "aa-inline-modal";

    const header = document.createElement("div");
    header.className = "aa-inline-modal-header";
    header.innerHTML = `<h3>Complete Your Application</h3>`;

    const closeBtn = document.createElement("button");
    closeBtn.type = "button";
    closeBtn.className = "aa-inline-modal-close";
    closeBtn.innerHTML = "&times;";
    header.appendChild(closeBtn);

    const subtitle = document.createElement("p");
    subtitle.className = "aa-inline-modal-subtitle";
    subtitle.textContent = "Please provide the missing information below:";

    const form = document.createElement("form");
    form.className = "aa-inline-modal-form";

    const inputs = {};
    const aiFilledKeys = new Set();

    function getPageContext() {
      const pageTitle = document.title || "";
      const pageUrl = window.location.href || "";
      const pageText = document.body?.innerText?.trim() || "";
      const normalizedText = pageText.replace(/\s+/g, " ").trim();
      return { title: pageTitle, url: pageUrl, text: normalizedText.slice(-15000) };
    }

    async function fillFieldWithAI(field) {
      try {
        const pageContext = getPageContext();
        const resumeData = await new Promise((resolve, reject) => {
          chrome.storage.local.get(["resume"], (result) => {
            if (chrome.runtime.lastError) {
              reject(new Error("Failed to retrieve resume from storage"));
            } else {
              resolve(result.resume || null);
            }
          });
        });

        const applicantContext = buildApplicantContext(resumeData, profileData);
        if (!applicantContext) {
          throw new Error("No resume or profile data available. Add one in the extension popup.");
        }

        const prompt = `
give me only value for this application field based on the applicant's data and the current page context provided. Do not give extra text.
FIELD TO EXTRACT:
Field Name: "${field.label || field.placeholder || field.key}"

PAGE CONTEXT:
Title: ${pageContext.title}
URL: ${pageContext.url}
Text: ${pageContext.text}

APPLICANT DATA:
${applicantContext}
`;
        const { apiKey, model } = await getApiSettings();
        if (!apiKey || !model) {
          throw new Error(
            "API key or model is not configured. Please open the extension popup and save your API settings.",
          );
        }

        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.3,
          }),
        });

        if (!response.ok) {
          const txt = await response.text();
          throw new Error(`LLM request failed: ${response.status} ${txt}`);
        }

        const data = await response.json();
        const value = data?.choices?.[0]?.message?.content?.trim() || "NOTFOUND";

        if (value && value !== "NOTFOUND") {
          inputs[field.key].value = value;
          inputs[field.key].dispatchEvent(new Event("input", { bubbles: true }));
          inputs[field.key].dispatchEvent(new Event("change", { bubbles: true }));
          aiFilledKeys.add(field.key);
        }
      } catch (error) {
        alert("Error: " + error.message);
      }
    }

    // Build form fields
    missingFields.forEach((field) => {
      const { displayLabel, placeholderText } = getDisplayLabelAndPlaceholder(field);

      const wrapper = document.createElement("div");
      wrapper.className = "aa-field-wrapper";

      const fieldContainer = document.createElement("div");
      fieldContainer.className = "aa-form-field";

      const label = document.createElement("label");
      label.textContent = displayLabel;
      label.htmlFor = field.key;

      const input = document.createElement("input");
      input.id = field.key;
      input.name = field.key;
      input.placeholder = placeholderText;

      // Set input type based on field.type
      const typeMap = {
        email: "email",
        tel: "tel",
        phone: "tel",
        number: "number",
        date: "date",
        url: "url",
        time: "time",
        month: "month",
        week: "week",
      };
      input.type = typeMap[field.type] || "text";

      fieldContainer.appendChild(label);
      fieldContainer.appendChild(input);
      wrapper.appendChild(fieldContainer);

      const aiBtn = document.createElement("button");
      aiBtn.type = "button";
      aiBtn.className = "aa-ai-fill-btn";
      aiBtn.innerHTML = `
        <span class="aa-ai-btn-spinner"></span>
        <span class="aa-ai-btn-label">🤖 AI</span>
      `;

      aiBtn.addEventListener("click", async (e) => {
        e.preventDefault();
        e.stopPropagation();
        aiBtn.classList.add("loading");
        aiBtn.disabled = true;
        await fillFieldWithAI(field);
        aiBtn.classList.remove("loading");
        aiBtn.disabled = false;
      });

      wrapper.appendChild(aiBtn);
      form.appendChild(wrapper);
      inputs[field.key] = input;
    });

    const submitBtn = document.createElement("button");
    submitBtn.type = "submit";
    submitBtn.textContent = "Submit & Auto-Fill";
    submitBtn.className = "aa-submit-btn";
    form.appendChild(submitBtn);

    modal.appendChild(header);
    modal.appendChild(subtitle);
    modal.appendChild(form);
    sidebar.appendChild(modal);

    function cleanup(result) {
      modal.remove();
      style.remove();
      resolve(result);
    }

    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      submitBtn.disabled = true;
      submitBtn.classList.add("loading");
      submitBtn.textContent = "";

      const values = {};
      missingFields.forEach((field) => {
        const value = inputs[field.key].value.trim();
        if (value) values[field.key] = value;
      });

      showSidebarLoader("Submitting your answers...");
      cleanup({ values, aiFilledKeys: Array.from(aiFilledKeys) });
    });

    closeBtn.addEventListener("click", () => {
      cleanup({ values: {}, aiFilledKeys: Array.from(aiFilledKeys) });
    });
  });
}

// ---- autoFillFields (for free-text) ----
async function autoFillFields(extractedFields, fieldValues, onProgress, profileData) {
  const missingFields = [];
  const filledValues = {};
  let resumeFile = null;

  try {
    resumeFile = await getResumeFileFromIndexedDB();
  } catch (error) {
    console.log("No resume file available for file inputs:", error.message);
  }

  const storedResume = await new Promise((resolve) => {
    try {
      chrome.storage.local.get(["resume"], (result) => {
        resolve(result?.resume || {});
      });
    } catch (e) {
      resolve({});
    }
  });

  const total = extractedFields.length;
  let processedCount = 0;

  for (const field of extractedFields) {
    processedCount += 1;

    if (field.type === "file") {
      const element = findFieldElement(field);
      if (element && resumeFile) {
        autoFillFileInput(element, resumeFile);
        filledValues[field.key] = "RESUME_FILE_UPLOADED";
      } else {
        console.log("Skipping manual prompt for file field:", field.key);
      }
      if (onProgress) onProgress(processedCount, total);
      continue;
    }

    const element = findFieldElement(field) || document.querySelector(field.selector);
    const pageValue = element?.value?.toString().trim();

    const llmValue =
      (fieldValues &&
        (fieldValues[field.key] ?? fieldValues[field.placeholder] ?? fieldValues[field.label])) ||
      null;

    const storedValue =
      (storedResume &&
        (storedResume[field.key] ??
          storedResume[field.placeholder] ??
          storedResume[field.label])) ||
      null;

    const profileValue = getProfileValueForField(profileData, field);

    const value = llmValue ?? storedValue ?? profileValue ?? pageValue;

    if (value && value !== "NOTFOUND") {
      filledValues[field.key] = value;
      fillInputField(element, value);
    } else {
      missingFields.push(field);
    }

    if (onProgress) onProgress(processedCount, total);
  }

  if (missingFields.length > 0) {
    hideSidebarLoader();

    const { values: manualValues, aiFilledKeys } = await promptForMissingValues(
      missingFields,
      profileData,
    );
    const valuesToSave = {};

    const manualEntries = Object.entries(manualValues).filter(([, value]) => value);
    const manualTotal = manualEntries.length;

    if (manualTotal > 0) {
      showSidebarLoader(`Filling submitted fields (0/${manualTotal})...`);
    }

    let manualFilled = 0;
    for (const [key, value] of manualEntries) {
      filledValues[key] = value;
      if (!aiFilledKeys.includes(key)) {
        valuesToSave[key] = value;
      }
      const field = extractedFields.find((f) => f.key === key);
      if (field) {
        const element = findFieldElement(field);
        fillInputField(element, value);
      }
      manualFilled += 1;
      updateSidebarLoader(`Filling submitted fields (${manualFilled}/${manualTotal})...`);
      await sleep(150);
    }

    if (manualTotal > 0) {
      hideSidebarLoader();
    }

    if (Object.keys(valuesToSave).length > 0) {
      await saveResumeFields(valuesToSave);
    }
  }

  return filledValues;
}

function saveResumeFields(values) {
  return new Promise((resolve, reject) => {
    if (!values || Object.keys(values).length === 0) {
      resolve();
      return;
    }
    chrome.storage.local.get(["resume"], (result) => {
      if (chrome.runtime.lastError) {
        reject(new Error("Could not access chrome storage to save resume values."));
        return;
      }
      let existingResume = result?.resume;
      if (typeof existingResume === "string") {
        existingResume = { rawText: existingResume };
      }
      if (!existingResume || typeof existingResume !== "object") {
        existingResume = {};
      }
      const mergedResume = { ...existingResume, ...values };
      chrome.storage.local.set({ resume: mergedResume }, () => {
        if (chrome.runtime.lastError) {
          reject(new Error("Failed to save resume values to storage."));
        } else {
          resolve();
        }
      });
    });
  });
}

function getResumeFileFromIndexedDB() {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage({ type: "GET_RESUME_FROM_IDB" }, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error("Failed to retrieve resume: " + chrome.runtime.lastError.message));
      } else if (response?.success) {
        const { fileData, fileName, fileType } = response.file;
        const blobArray = new Uint8Array(Object.values(fileData));
        const blob = new Blob([blobArray], { type: fileType });
        const file = new File([blob], fileName, { type: fileType });
        resolve(file);
      } else {
        reject(new Error(response?.error || "No resume found in local database"));
      }
    });
  });
}

function findFileInputs() {
  const selectors = [
    'input[type="file"]',
    'input[type="file"][accept*="pdf"]',
    'input[type="file"][accept*="doc"]',
    'input[type="file"][accept*="resume"]',
    'input[accept*="pdf"]',
    'input[accept*="resume"]',
    'input[name*="resume"]',
    'input[name*="cv"]',
    'input[name*="document"]',
    'input[id*="resume"]',
    'input[id*="cv"]',
    'input[id*="document"]',
  ];
  const fileInputs = new Set();
  selectors.forEach((selector) => {
    try {
      document.querySelectorAll(selector).forEach((input) => {
        if (input.type === "file" && !input.disabled) {
          fileInputs.add(input);
        }
      });
    } catch (e) {
      console.log("Invalid selector:", selector, e.message);
    }
  });
  return Array.from(fileInputs);
}

function autoFillFileInput(fileInput, file) {
  try {
    try {
      const dataTransfer = new DataTransfer();
      dataTransfer.items.add(file);
      fileInput.files = dataTransfer.files;
    } catch (e) {
      const fileList = {
        0: file,
        length: 1,
        item: function (index) {
          return this[index] || null;
        },
      };
      Object.defineProperty(fileInput, "files", {
        value: fileList,
        writable: true,
      });
    }
    fileInput.dispatchEvent(new Event("change", { bubbles: true }));
    fileInput.dispatchEvent(new Event("input", { bubbles: true }));
    fileInput.dispatchEvent(new Event("focus", { bubbles: true }));
    fileInput.dispatchEvent(new Event("blur", { bubbles: true }));
    return true;
  } catch (error) {
    return false;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ============================================================
// IMPROVED DROPDOWN FILLING LOGIC
// ============================================================

/**
 * Find the trigger element for a dropdown (button/div that opens the menu).
 * Handles native select, custom buttons, and various frameworks.
 */
function findDropdownTrigger(originalInput) {
  if (!originalInput) return null;
  if (originalInput.tagName === "SELECT") return originalInput;
  if (originalInput.tagName === "BUTTON" || originalInput.getAttribute("role") === "button") {
    return originalInput;
  }
  let parent = originalInput.parentElement;
  while (parent && parent !== document.body) {
    if (
      parent.getAttribute("role") === "combobox" ||
      parent.hasAttribute("aria-haspopup") ||
      parent.classList.contains("select") ||
      parent.classList.contains("dropdown") ||
      parent.classList.contains("react-select") ||
      parent.classList.contains("downshift") ||
      parent.matches('[data-testid*="select"], [data-component*="select"]')
    ) {
      const button = parent.querySelector(
        'button, div[role="button"], .dropdown-toggle, .select-toggle',
      );
      if (button) return button;
      if (parent.getAttribute("role") === "button" || parent.tabIndex >= 0) return parent;
    }
    parent = parent.parentElement;
  }
  const sibling = originalInput.nextElementSibling || originalInput.previousElementSibling;
  if (sibling && (sibling.tagName === "BUTTON" || sibling.getAttribute("role") === "button")) {
    return sibling;
  }
  return originalInput;
}

/**
 * Check if a node is an option element.
 */
function isOptionElement(node) {
  if (node.nodeType !== 1) return false;
  const tag = node.tagName.toLowerCase();
  if (tag === "option") return true;
  if (node.getAttribute("role") === "option") return true;
  const cls = node.className || "";
  if (cls.includes("option") || cls.includes("item") || cls.includes("dropdown-item")) return true;
  if (node.hasAttribute("data-option") || node.hasAttribute("data-value")) return true;
  if (node.hasAttribute("aria-selected") || node.hasAttribute("aria-checked")) return true;
  return false;
}

/**
 * Extract options from a dropdown, returning array of { value, label, element }.
 * Handles native selects, already-visible menus, and opens+observes for dynamic ones.
 * Returns empty array if no options found.
 */
async function extractOptions(triggerEl, originalInput) {
  // Native select
  if (originalInput && originalInput.tagName === "SELECT") {
    const opts = Array.from(originalInput.options)
      .filter((o) => o.value && o.value.trim() && o.text && o.text.trim())
      .map((o) => ({
        value: o.value.trim(),
        label: o.text.trim(),
        element: o,
      }));
    return opts;
  }

  // Already visible menus
  const visibleSelectors = [
    '[role="listbox"]:not([hidden])',
    '[role="menu"]:not([hidden])',
    '.dropdown-menu:not([style*="display: none"])',
    '.select-dropdown:not([style*="display: none"])',
    ".react-select__menu",
    ".downshift-menu",
    ".dropdown-options",
    ".MuiAutocomplete-popper",
    ".ant-select-dropdown",
    '.MuiPopover-root [role="listbox"]',
  ];
  for (const selector of visibleSelectors) {
    const container = document.querySelector(selector);
    if (container && container.offsetParent !== null) {
      const optionEls = container.querySelectorAll(
        '[role="option"], li, .option, .item, .dropdown-item, [data-option], [data-value]',
      );
      if (optionEls.length) {
        return Array.from(optionEls)
          .map((el) => ({
            value:
              el.dataset?.value ??
              el.getAttribute("data-value") ??
              el.getAttribute("value") ??
              el.textContent.trim(),
            label: el.textContent.trim(),
            element: el,
          }))
          .filter((o) => o.label);
      }
    }
  }

  // Open and observe for new options
  const openAndObserve = () => {
    triggerEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
    triggerEl.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    triggerEl.click();
    if (
      originalInput &&
      (originalInput.tagName === "INPUT" || originalInput.tagName === "TEXTAREA")
    ) {
      originalInput.focus();
    }
    triggerEl.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true }));
  };

  const options = await new Promise((resolve) => {
    let resolved = false;
    const optionsList = [];

    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (isOptionElement(node)) {
            optionsList.push(node);
          } else {
            const found = node.querySelectorAll(
              '[role="option"], li, .option, .item, .dropdown-item, [data-option], [data-value]',
            );
            optionsList.push(...found);
          }
        }
      }
      if (optionsList.length > 0 && !resolved) {
        resolved = true;
        observer.disconnect();
        resolve(optionsList);
      }
    });

    observer.observe(document.body, { childList: true, subtree: true });
    openAndObserve();

    setTimeout(() => {
      if (!resolved) {
        resolved = true;
        observer.disconnect();
        // Fallback: scan for visible options
        const fallbackOptions = document.querySelectorAll(
          '[role="option"], li, .option, .item, .dropdown-item, [data-option], [data-value]',
        );
        const visible = Array.from(fallbackOptions).filter((el) => el.offsetParent !== null);
        resolve(visible);
      }
    }, 3000);
  });

  // Close dropdown (Escape)
  triggerEl.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  await sleep(100);

  return options
    .map((el) => ({
      value:
        el.dataset?.value ??
        el.getAttribute("data-value") ??
        el.getAttribute("value") ??
        el.textContent.trim(),
      label: el.textContent.trim(),
      element: el,
    }))
    .filter((o) => o.label);
}

/**
 * Use LLM (with fallback) to match the best option from the list.
 */
async function matchOptionWithLLM(fieldLabel, options, applicantContext) {
  const optionLabels = [...new Set(options.map((o) => o.label))];
  if (!optionLabels.length) return null;

  // Fast exact match from context
  const contextLower = applicantContext.toLowerCase();
  const exactMatch = options.find((o) => contextLower.includes(o.label.toLowerCase()));
  if (exactMatch) {
    console.log(`Exact match found in context: "${exactMatch.label}"`);
    return exactMatch;
  }

  try {
    const { apiKey, model } = await getApiSettings();
    if (!apiKey || !model) {
      console.warn("API not configured, skipping LLM for dropdown");
      return options[0]; // first as fallback
    }

    const prompt = `
You are selecting a value for a job application dropdown.

Field: "${fieldLabel}"

Available options (exact labels):
${optionLabels.join("\n")}

Applicant data:
${applicantContext}

Instructions:
- Return only the label from the Available Options that best matches the applicant's information.
- If the applicant's exact value is not available, choose the closest available option.
- Do not invent values; your response must be one of the listed options exactly.
- Return only the option label, no extra text.
`;

    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        temperature: 0,
      }),
    });

    const data = await response.json();
    let chosenLabel = data?.choices?.[0]?.message?.content?.trim() || "";
    chosenLabel = chosenLabel.replace(/^["'`\s]+|["'`\s]+$/g, "");

    let matched = options.find((o) => o.label.toLowerCase() === chosenLabel.toLowerCase());
    if (!matched) {
      matched = options.find((o) => o.label.toLowerCase().includes(chosenLabel.toLowerCase()));
    }
    if (!matched) {
      matched = options.find((o) => chosenLabel.toLowerCase().includes(o.label.toLowerCase()));
    }
    if (!matched) {
      console.warn(`No match found for "${chosenLabel}", using first option`);
      matched = options[0];
    }
    return matched;
  } catch (err) {
    console.warn("LLM failed for dropdown, using fallback:", err);
    return options[0];
  }
}

/**
 * Main function to fill a single dropdown field.
 * Returns true if successfully filled, false otherwise (e.g., no options).
 */
async function fillDropdownFields(dropdownField, applicantContext) {
  try {
    if (!dropdownField?.selector) {
      console.warn("Missing selector for dropdown:", dropdownField);
      return false;
    }

    const originalInput = document.querySelector(dropdownField.selector);
    if (!originalInput) {
      console.warn(
        `Dropdown element not found: "${dropdownField.label}" (${dropdownField.selector})`,
      );
      return false;
    }

    // If already has a value, skip (but our extractor usually excludes filled, but just in case)
    if (originalInput.value && originalInput.value.trim()) {
      return true;
    }

    const trigger = findDropdownTrigger(originalInput);
    if (!trigger) {
      console.warn(`Could not find trigger for dropdown "${dropdownField.label}"`);
      return false;
    }

    // Native select
    if (originalInput.tagName === "SELECT") {
      const options = await extractOptions(trigger, originalInput);
      if (!options.length) {
        console.warn(`No options for native select "${dropdownField.label}"`);
        return false;
      }
      const matched = await matchOptionWithLLM(dropdownField.label, options, applicantContext);
      if (!matched) return false;

      // Set value and selectedIndex
      originalInput.value = matched.value;
      // Also set selectedIndex for safety
      for (let i = 0; i < originalInput.options.length; i++) {
        if (originalInput.options[i].value === matched.value) {
          originalInput.selectedIndex = i;
          break;
        }
      }
      // Dispatch events
      originalInput.dispatchEvent(new Event("change", { bubbles: true }));
      originalInput.dispatchEvent(new Event("input", { bubbles: true }));
      originalInput.focus();
      originalInput.blur();
      console.log(`✅ Native select "${dropdownField.label}" → "${matched.label}"`);
      return true;
    }

    // Custom dropdown
    // Close any open dropdown to reset state
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await sleep(100);

    // Open dropdown
    trigger.click();
    await sleep(200);

    // Extract options
    const options = await extractOptions(trigger, originalInput);
    if (!options.length) {
      console.warn(`No options extracted for "${dropdownField.label}"`);
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return false;
    }

    // Match with LLM
    const matched = await matchOptionWithLLM(dropdownField.label, options, applicantContext);
    if (!matched) {
      trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
      return false;
    }

    // Click the matched option
    const targetEl = matched.element;
    if (targetEl) {
      targetEl.scrollIntoView({ block: "nearest" });
      await sleep(50);
      targetEl.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
      targetEl.click();
      targetEl.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      targetEl.focus();
    }

    // Verify selection
    await sleep(300);
    let selectedText = null;
    const displayEl = trigger.querySelector(
      '[class*="single-value"], .selected-value, .select__single-value, .dropdown-selected',
    );
    if (displayEl) {
      selectedText = displayEl.textContent?.trim();
    }
    const inputValue = originalInput.value?.trim();
    const finalValue = selectedText || inputValue || "";

    // Close dropdown
    trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    if (originalInput.tagName === "INPUT" || originalInput.tagName === "TEXTAREA") {
      originalInput.blur();
    }

    if (finalValue && finalValue.toLowerCase() !== matched.label.toLowerCase()) {
      console.warn(
        `Verification mismatch. Expected "${matched.label}", got "${finalValue}". Attempting direct set.`,
      );
      if (originalInput.tagName === "INPUT" || originalInput.tagName === "TEXTAREA") {
        originalInput.value = matched.label;
        originalInput.dispatchEvent(new Event("input", { bubbles: true }));
        originalInput.dispatchEvent(new Event("change", { bubbles: true }));
      }
    } else {
      console.log(`✅ Custom dropdown "${dropdownField.label}" → "${matched.label}"`);
    }
    return true;
  } catch (err) {
    console.error(`Error filling dropdown "${dropdownField.label}":`, err);
    try {
      const trigger = document
        .querySelector(dropdownField.selector)
        ?.parentElement?.querySelector('button, [role="button"]');
      if (trigger)
        trigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    } catch (_) {}
    return false;
  }
}

// ---- auto-fill all file inputs ----
function autoFillAllFileInputs(file) {
  const fileInputs = findFileInputs();
  if (fileInputs.length === 0) return;
  fileInputs.forEach((fileInput) => {
    autoFillFileInput(fileInput, file);
  });
}

// ---- main auto-apply orchestration ----
async function performAutoApply(resumeData, profileData) {
  showSidebarLoader("Scanning the form...");

  try {
    const extractedFields = extractFormFields();
    console.log("extracted from fields ------------> ", extractedFields);

    const applicantContext = buildApplicantContext(resumeData, profileData);
    if (!applicantContext.trim()) {
      throw new Error("Resume and profile data are both empty or invalid.");
    }

    // 1. Radio groups
    const radioGroups = extractRadioGroups();
    if (radioGroups.length) {
      for (let i = 0; i < radioGroups.length; i++) {
        updateSidebarLoader(`Filling radio options (${i + 1}/${radioGroups.length})...`);
        await fillRadioGroup(radioGroups[i], applicantContext);
        await sleep(200);
      }
    }

    // 2. Dropdown fields
    const dropdownFields = extractedFields.filter((field) => field.isDropdown === true);
    const failedDropdowns = [];
    if (dropdownFields.length) {
      for (let i = 0; i < dropdownFields.length; i++) {
        updateSidebarLoader(`Filling dropdown fields (${i + 1}/${dropdownFields.length})...`);
        const success = await fillDropdownFields(dropdownFields[i], applicantContext);
        if (!success) {
          // Add to failed list for manual prompt
          failedDropdowns.push(dropdownFields[i]);
        }
      }
    }

    // If any dropdowns failed, prompt user for those fields
    if (failedDropdowns.length > 0) {
      hideSidebarLoader(); // hide loader before modal
      const { values: manualValues } = await promptForMissingValues(failedDropdowns, profileData);
      // Fill each failed dropdown with user's answer
      for (const [key, value] of Object.entries(manualValues)) {
        const field = failedDropdowns.find((f) => f.key === key);
        if (field && value) {
          const element = findFieldElement(field);
          if (element) {
            // Try to fill as text input (since dropdown failed, it's likely a text field misclassified)
            fillInputField(element, value);
          }
        }
      }
      // Re-show loader after modal closes (though we're about to continue with other steps)
      showSidebarLoader("Continuing...");
    }

    // 3. Normal text/textarea fields via LLM
    const normalFields = extractedFields.filter((field) => field.isDropdown !== true);
    if (!normalFields.length && !dropdownFields.length && !radioGroups.length) {
      throw new Error("No form fields were found on this page.");
    }

    if (normalFields.length) {
      updateSidebarLoader(
        `Reading your resume and profile for ${normalFields.length} field${normalFields.length > 1 ? "s" : ""}...`,
      );
      const fieldValues = await callGeminiApi({
        fields: normalFields,
        context: applicantContext,
      });

      const resumeUpdates = Object.fromEntries(
        Object.entries(fieldValues).filter(([, value]) => value && value !== "NOTFOUND"),
      );
      if (Object.keys(resumeUpdates).length > 0) {
        await saveResumeFields(resumeUpdates);
      }

      updateSidebarLoader(`Filling fields (0/${normalFields.length})...`);
      await autoFillFields(
        normalFields,
        fieldValues,
        (done, total) => {
          updateSidebarLoader(`Filling fields (${done}/${total})...`);
        },
        profileData,
      );
    }

    // 4. File inputs
    updateSidebarLoader("Attaching your resume file...");
    try {
      const resumeFile = await getResumeFileFromIndexedDB();
      autoFillAllFileInputs(resumeFile);
    } catch (error) {
      console.log("Could not auto-fill file inputs:", error.message);
    }

    return {
      success: true,
      message:
        "Fields were populated. Missing values were requested manually and stored for future use.",
    };
  } finally {
    hideSidebarLoader();
  }
}

// ---- message listener ----
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "START_AUTO_APPLY") return;
  performAutoApply(message.resumeData, message.profileData)
    .then((result) => sendResponse(result))
    .catch((error) => {
      sendResponse({ success: false, error: error.message || "Auto apply failed." });
    });
  return true;
});

// ---- initialize bot ----
createFloatingBot();
injectAutoApplyGlobalStyles();
