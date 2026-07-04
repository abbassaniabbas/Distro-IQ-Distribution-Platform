export function qs(selector, parent = document) {
  return parent.querySelector(selector);
}

export function qsa(selector, parent = document) {
  return [...parent.querySelectorAll(selector)];
}

export function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (character) => {
    const entities = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    };

    return entities[character];
  });
}

export function applySearchFilter(root, query) {
  const normalizedQuery = query.trim().toLowerCase();
  const searchableItems = qsa("[data-search-index]", root);

  searchableItems.forEach((item) => {
    const haystack = item.dataset.searchIndex || "";
    item.hidden = Boolean(normalizedQuery) && !haystack.includes(normalizedQuery);
  });
}
