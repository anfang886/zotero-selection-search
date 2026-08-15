/*
 * Selection Search for Zotero
 * https://github.com/anfang886/zotero-selection-search
 *
 * Adds a "Search for ..." entry to the item pane's field context menu.
 * Selecting text and choosing it selects My Library and runs a quick search,
 * replacing the copy / click My Library / paste / Enter sequence.
 *
 * Licensed under the MIT License.
 */

var ZSearchMenu;

const XUL_NS = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";

// Selections longer than this are almost certainly accidental (a whole
// abstract dragged over) and would return zero results. The menu entry is
// hidden rather than silently truncating the query.
const MAX_QUERY_LENGTH = 200;

// How much of the selection to show in the menu label itself.
const MAX_LABEL_LENGTH = 25;

// Zotero's quick search box. The entry is suppressed there — searching for
// text selected inside the search box itself is meaningless.
const QUICK_SEARCH_ID = "zotero-tb-search";

function log(msg) {
	Zotero.debug("Selection Search: " + msg);
}

/**
 * Menu label, localised without Fluent — the plugin has exactly one string,
 * and a plain lookup here cannot fail to resolve at runtime.
 *
 * Only locales that have actually been tested are listed. Everything else
 * falls back to English, which is better than shipping an unverified
 * translation.
 */
function labelFor(text) {
	let loc = String(Zotero.locale || "en-US").toLowerCase();
	if (loc.startsWith("zh-tw") || loc.startsWith("zh-hant") || loc.startsWith("zh-hk")) {
		return `\u641c\u5c0b\u300c${text}\u300d`;
	}
	if (loc.startsWith("zh")) {
		return `\u641c\u7d22\u300c${text}\u300d`;
	}
	if (loc.startsWith("ja")) {
		return `\u300c${text}\u300d\u3092\u691c\u7d22`;
	}
	// Every other locale falls back to English rather than to a translation
	// nobody has checked. Contributions welcome — see CONTRIBUTING notes in
	// the README.
	return `Search for "${text}"`;
}

function makeSelectionSearch() {
	return {
		_handlers: new WeakMap(),

		/* ---------------------------------------------------------------- */
		/* Lifecycle                                                        */
		/* ---------------------------------------------------------------- */

		init(win) {
			if (this._handlers.has(win)) {
				return;
			}
			let handler = event => this.onPopupShowing(win, event);
			win.document.addEventListener("popupshowing", handler, true);
			this._handlers.set(win, handler);
			log("attached to window");
		},

		uninit(win) {
			let handler = this._handlers.get(win);
			if (handler) {
				win.document.removeEventListener("popupshowing", handler, true);
				this._handlers.delete(win);
			}
			win.document.getElementById("selection-search-item")?.remove();
			win.document.getElementById("selection-search-sep")?.remove();
			log("detached from window");
		},

		/* ---------------------------------------------------------------- */
		/* Menu detection                                                   */
		/* ---------------------------------------------------------------- */

		/**
		 * Walk up from a node, crossing shadow DOM boundaries.
		 */
		_ancestors(node) {
			let out = [];
			let el = node;
			while (el && out.length < 64) {
				out.push(el);
				el = el.parentElement
					|| (el.getRootNode && el.getRootNode() !== el && el.getRootNode().host)
					|| null;
			}
			return out;
		},

		/**
		 * Find the editable field this context menu was opened on.
		 *
		 * Detection is by LOCATION, not by menu contents. An earlier version
		 * matched on the "Title Case" / "Sentence case" entries Zotero adds to
		 * this menu — which works only in English, because those labels are
		 * translated in every other locale. popup.triggerNode is the element that
		 * was right-clicked and carries no language dependency at all.
		 */
		_findEditableField(win, popup) {
			let node = popup.triggerNode || win.document.activeElement;
			if (node) {
				// The trigger may be the input itself, or a wrapper around it.
				for (let el of this._ancestors(node)) {
					let name = String(el.localName || "").toLowerCase();
					if (name === "input" || name === "textarea") {
						return el;
					}
				}
				if (typeof node.querySelector === "function") {
					let inner = node.querySelector("input, textarea");
					if (inner) {
						return inner;
					}
				}
			}

			// Last resort: focus may sit on the field even when triggerNode
			// resolves to something unhelpful.
			let active = win.document.activeElement;
			while (active?.shadowRoot?.activeElement) {
				active = active.shadowRoot.activeElement;
			}
			let activeName = String(active?.localName || "").toLowerCase();
			if (activeName === "input" || activeName === "textarea") {
				return active;
			}
			return null;
		},

		/**
		 * True if the field is Zotero's own quick search box.
		 */
		_isQuickSearch(field) {
			return this._ancestors(field).some(el => el.id === QUICK_SEARCH_ID);
		},

		/**
		 * Read the selection from a field.
		 *
		 * Text selected inside an <input> or <textarea> is NOT visible to
		 * window.getSelection() — it has to come from selectionStart /
		 * selectionEnd. getSelection() is the fallback for read-only regions.
		 *
		 * trim() removes U+3000 (ideographic space) as well as ASCII
		 * whitespace, so CJK selections need no special handling.
		 */
		getSelectedText(win, field) {
			if (field && typeof field.selectionStart === "number" && field.value != null) {
				let text = field.value.substring(field.selectionStart, field.selectionEnd);
				if (text.trim()) {
					return text.trim();
				}
			}
			return String(win.getSelection()?.toString() || "").trim();
		},

		/* ---------------------------------------------------------------- */
		/* Menu injection                                                   */
		/* ---------------------------------------------------------------- */

		onPopupShowing(win, event) {
			let popup = event.target;
			if (popup.tagName !== "menupopup") {
				return;
			}

			let doc = win.document;

			// Rebuild every time — the label carries the current selection.
			doc.getElementById("selection-search-item")?.remove();
			doc.getElementById("selection-search-sep")?.remove();

			let field = this._findEditableField(win, popup);
			if (!field || this._isQuickSearch(field)) {
				return;
			}

			let text = this.getSelectedText(win, field);

			// No selection means no entry at all, rather than a disabled one:
			// this menu also opens on an empty field, where searching is
			// meaningless.
			if (!text || text.length > MAX_QUERY_LENGTH) {
				return;
			}

			let separator = doc.createElementNS(XUL_NS, "menuseparator");
			separator.id = "selection-search-sep";

			let shown = text.length > MAX_LABEL_LENGTH
				? text.slice(0, MAX_LABEL_LENGTH) + "\u2026"
				: text;

			let item = doc.createElementNS(XUL_NS, "menuitem");
			item.id = "selection-search-item";
			item.setAttribute("label", labelFor(shown));
			item.addEventListener("command", () => {
				this.doSearch(win, text).catch(err => Zotero.logError(err));
			});

			popup.appendChild(separator);
			popup.appendChild(item);
		},

		/* ---------------------------------------------------------------- */
		/* The search itself                                                */
		/* ---------------------------------------------------------------- */

		/**
		 * The three manual steps this plugin exists to collapse:
		 * click My Library, paste into the quick search box, press Enter.
		 *
		 * The search mode is deliberately left untouched. Zotero's default
		 * (Title, Creator, Year) is what makes the result set useful for
		 * checking a reference; switching to "Everything" would pull in
		 * full-text PDF matches and bury the item being looked for.
		 */
		async doSearch(win, text) {
			let pane = win.ZoteroPane;
			if (!pane) {
				log("no ZoteroPane in this window");
				return;
			}

			await pane.collectionsView.selectLibrary(Zotero.Libraries.userLibraryID);

			let searchBox = win.document.getElementById(QUICK_SEARCH_ID);
			if (!searchBox) {
				log("quick search box not found — Zotero may have renamed it");
				return;
			}

			searchBox.value = text;

			if (typeof pane.search === "function") {
				await pane.search();
			}
			else {
				searchBox.dispatchEvent(new win.Event("command", { bubbles: true }));
			}
		}
	};
}

/* -------------------------------------------------------------------- */
/* Zotero bootstrap entry points                                        */
/* -------------------------------------------------------------------- */

function install() {}

function uninstall() {}

async function startup({ version }) {
	log("starting version " + version);
	ZSearchMenu = makeSelectionSearch();

	// onMainWindowLoad only fires for windows opened after this point, so
	// windows already open when the plugin is enabled are attached here.
	for (let win of Zotero.getMainWindows()) {
		if (win.ZoteroPane) {
			ZSearchMenu.init(win);
		}
	}
}

function shutdown() {
	log("shutting down");
	if (!ZSearchMenu) {
		return;
	}
	for (let win of Zotero.getMainWindows()) {
		ZSearchMenu.uninit(win);
	}
	ZSearchMenu = undefined;
}

function onMainWindowLoad({ window }) {
	ZSearchMenu?.init(window);
}

function onMainWindowUnload({ window }) {
	ZSearchMenu?.uninit(window);
}
