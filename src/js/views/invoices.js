import {
  downloadInvoice,
  getFinancialInvoiceRecords,
  getInvoiceRecords,
  INVOICE_DOCUMENT_TYPES,
  invoiceDocumentLabel,
  invoiceDocumentType,
  openInvoiceQuickView,
  printInvoice
} from "../services/invoices.js?v=20260804i";
import { formatCurrency, formatDate, formatNumber, statusText } from "../services/formatters.js";
import { printTabularReport } from "../services/report-export.js";
import { currentUserRole } from "../services/rbac.js?v=20260801d";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { iconButton, metricCard, panelHeader, statusPill, table } from "../ui/components.js";

const INVOICE_PAGE_SIZE = 10;
const REPRESENTATIVE_STOCK_DOCUMENT_TYPES = new Set([
  INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_DISPATCH_NOTE,
  INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_PURCHASE_RECEIPT,
  INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_DEPOSIT_RECEIPT,
  INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_STOCK_TRANSFER_NOTE
]);
const CUSTOMER_SALE_DOCUMENT_TYPES = new Set([
  INVOICE_DOCUMENT_TYPES.FACTORY_CUSTOMER_INVOICE,
  INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_CUSTOMER_RECEIPT,
  INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_CUSTOMER_INVOICE
]);

function visibleInvoiceRecords(state) {
  const role = currentUserRole(state);
  const records = getInvoiceRecords(state);
  if (role === "sales_rep") {
    return records.filter((invoice) => [
      INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_CUSTOMER_RECEIPT,
      INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_CUSTOMER_INVOICE,
      ...REPRESENTATIVE_STOCK_DOCUMENT_TYPES
    ].includes(invoiceDocumentType(invoice, state)));
  }
  if (role === "store_keeper") {
    return records.filter((invoice) => REPRESENTATIVE_STOCK_DOCUMENT_TYPES.has(invoiceDocumentType(invoice, state)));
  }
  return records;
}

function invoiceProductSummary(invoice) {
  const items = invoice.items || [];
  if (!items.length) return "No product details";
  const first = items[0];
  const remaining = items.length - 1;
  return `${first.productName || first.productId || "Product"}${remaining ? ` +${remaining} more` : ""}`;
}

function invoiceSearchIndex(invoice, state) {
  return `${invoice.id} ${invoice.customerName} ${invoice.repName} ${invoice.paymentType} ${invoice.status} ${invoiceDocumentLabel(invoice, state)} ${invoiceProductSummary(invoice)}`.toLowerCase();
}

function invoicePaymentLabel(invoice) {
  return statusText(invoice.paymentType || "cash");
}

function renderInvoiceRows(invoices, state) {
  const isRepresentative = currentUserRole(state) === "sales_rep";
  return invoices.map((invoice, index) => `
    <tr ${index >= INVOICE_PAGE_SIZE ? "hidden " : ""}data-rep-invoice-row data-invoice-status="${escapeHtml(invoice.status || "open")}" data-invoice-document-type="${escapeHtml(invoiceDocumentType(invoice, state))}" data-search-index="${escapeHtml(invoiceSearchIndex(invoice, state))}">
      <td><strong>${escapeHtml(invoice.id)}</strong><div class="muted">${formatDate(invoice.issuedAt)}</div></td>
      <td>${escapeHtml(invoice.customerName || "Customer")}</td>
      <td>${escapeHtml(invoiceProductSummary(invoice))}</td>
      <td><strong>${escapeHtml(invoiceDocumentLabel(invoice, state))}</strong><div class="muted">${escapeHtml(invoicePaymentLabel(invoice))}</div></td>
      <td>${formatCurrency(invoice.amount)}</td>
      <td>${statusPill(invoice.status)}</td>
      <td>
        <div class="row-actions invoice-row-actions">
          ${iconButton({ iconName: "eye", label: "View", className: "js-view-invoice", data: { "invoice-id": invoice.id } })}
          ${iconButton({ iconName: "download", label: "Download", className: "js-download-invoice", data: { "invoice-id": invoice.id } })}
          ${iconButton({ iconName: "print", label: "Print", className: "js-print-invoice", data: { "invoice-id": invoice.id } })}
          ${isRepresentative && invoiceDocumentType(invoice, state) === INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_CUSTOMER_INVOICE
            ? iconButton({ iconName: "wallet", label: "Update credit invoice", className: "js-edit-rep-credit-invoice", data: { "invoice-id": invoice.id } })
            : ""}
        </div>
      </td>
    </tr>
  `);
}

function renderRepresentativeCreditInvoiceModal() {
  return `
    <div id="rep-credit-invoice-modal" class="stock-modal-backdrop" tabindex="-1" hidden>
      <section class="stock-modal compact-record-modal" role="dialog" aria-modal="true" aria-labelledby="rep-credit-invoice-title">
        <header class="stock-modal-header">
          <div><span class="eyebrow">Customer credit</span><h2 id="rep-credit-invoice-title">Update credit invoice</h2></div>
          ${iconButton({ iconName: "x", label: "Close credit invoice editor", className: "js-close-rep-credit-invoice" })}
        </header>
        <form id="rep-credit-invoice-form" class="form-grid" novalidate>
          <input type="hidden" name="invoiceId">
          <div class="span-full muted" data-rep-credit-invoice-summary></div>
          <label class="field">
            <span>Payment status</span>
            <select name="status" required>
              <option value="open">Awaiting payment</option>
              <option value="paid">Paid</option>
            </select>
          </label>
          <label class="field">
            <span>Due date</span>
            <input name="dueAt" type="date" required>
          </label>
          <label class="field span-full">
            <span>Payment note</span>
            <textarea name="paymentNote" rows="3" placeholder="Payment reference, promise date, part-payment note, or collection details"></textarea>
          </label>
          <span class="field-error span-full" data-rep-credit-invoice-error></span>
          <div class="form-actions span-full">
            <button class="button" type="button" data-close-rep-credit-invoice>Cancel</button>
            <button class="button primary" type="submit">Save credit invoice</button>
          </div>
        </form>
      </section>
    </div>
  `;
}

export function renderInvoices({ state }) {
  const invoices = visibleInvoiceRecords(state);
  const isRepresentative = currentUserRole(state) === "sales_rep";
  const isStoreKeeper = currentUserRole(state) === "store_keeper";
  const heading = isRepresentative ? "My invoices" : "Invoices";
  const today = new Date().toISOString().slice(0, 10);
  const todayInvoices = invoices.filter((invoice) => invoice.issuedAt === today);
  const financialInvoices = getFinancialInvoiceRecords(state);
  const financialInvoicesById = new Map(financialInvoices.map((invoice) => [invoice.id, invoice]));
  const salesInvoices = isRepresentative
    ? invoices.filter((invoice) => CUSTOMER_SALE_DOCUMENT_TYPES.has(invoiceDocumentType(invoice, state)))
    : invoices.map((invoice) => financialInvoicesById.get(invoice.id)).filter(Boolean);
  const totalValue = salesInvoices.reduce((total, invoice) => total + Number(invoice.amount || 0), 0);
  const openValue = (isRepresentative ? invoices : financialInvoices)
    .filter((invoice) => ["open", "overdue"].includes(invoice.status))
    .reduce((total, invoice) => total + Number(invoice.amount || 0), 0);

  return `
    <section class="view invoices-view">
      <div class="metric-grid invoice-metrics">
        ${metricCard({ label: heading, value: formatNumber(invoices.length), meta: isRepresentative ? "Your customer sales and stock documents" : isStoreKeeper ? "Representative stock documents" : "Sales, receipts, and stock-transfer documents", iconName: "orders" })}
        ${metricCard({ label: "Today", value: formatNumber(todayInvoices.length), meta: "Documents created today", iconName: "clock" })}
        ${metricCard({ label: isStoreKeeper ? "Stock value" : "Total sales", value: formatCurrency(isStoreKeeper ? invoices.reduce((sum, invoice) => sum + Number(invoice.stockValue ?? invoice.amount ?? 0), 0) : totalValue), meta: isStoreKeeper ? "Value issued or sold to representatives" : isRepresentative ? "Your customer sales only" : "Factory sales only; deposits and transfers excluded", iconName: "finance" })}
        ${metricCard({ label: "Still unpaid", value: formatCurrency(openValue), meta: "Credit documents awaiting payment", iconName: "wallet" })}
      </div>
      <section class="panel">
        ${panelHeader(
          heading,
          isStoreKeeper
            ? "Review, download, or print sales rep purchase receipts, stock deposit receipts, and stock-transfer notes"
            : isRepresentative
              ? "Review customer sales and documents connected to stock collected from the factory"
              : "Review customer invoices, representative receipts, and stock-transfer documents",
          `<div class="table-document-actions" aria-label="Invoice list actions">
            ${iconButton({ iconName: "print", label: "Print invoice list", className: "js-print-invoice-list", disabled: !invoices.length })}
          </div>`
        )}
        <div class="invoice-simple-filters" aria-label="Invoice filters">
          <label class="field">
            <span>Find invoice</span>
            <input type="search" data-invoice-filter placeholder="Invoice, customer, product or representative" autocomplete="off">
          </label>
          <label class="field">
            <span>Status</span>
            <select data-invoice-status-filter>
              <option value="all">All statuses</option>
              <option value="paid">Paid</option>
              <option value="recorded">Recorded</option>
              <option value="open">Open</option>
              <option value="overdue">Overdue</option>
            </select>
          </label>
          <label class="field">
            <span>Document</span>
            <select data-invoice-document-filter>
              <option value="all">All documents</option>
              <option value="customer_sales">Customer sales</option>
              <option value="${INVOICE_DOCUMENT_TYPES.FACTORY_CUSTOMER_INVOICE}">Factory customer invoices</option>
              <option value="${INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_CUSTOMER_RECEIPT}">Customer receipts</option>
              <option value="${INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_CUSTOMER_INVOICE}">Representative credit invoices</option>
              <option value="${INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_PURCHASE_RECEIPT}">Sales rep purchase receipts</option>
              <option value="${INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_DEPOSIT_RECEIPT}">Stock deposit receipts</option>
              <option value="${INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_STOCK_TRANSFER_NOTE}">Stock transfer notes</option>
              <option value="${INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_DISPATCH_NOTE}">Legacy stock transfer notes</option>
            </select>
          </label>
        </div>
        ${table(
          ["Document", "Customer / recipient", "Products", "Document type", "Total", "Status", "Actions"],
          renderInvoiceRows(invoices, state),
          isStoreKeeper ? "No representative stock documents yet." : "No invoice or receipt documents yet."
        )}
        <div class="activity-pagination" data-rep-invoice-pagination hidden>
          <button class="button" type="button" data-rep-invoice-page="prev">Previous</button>
          <span data-rep-invoice-page-status>Page 1 of 1</span>
          <button class="button" type="button" data-rep-invoice-page="next">Next</button>
        </div>
      </section>
      ${isRepresentative ? renderRepresentativeCreditInvoiceModal() : ""}
    </section>
  `;
}

export function bindInvoices({ root, store, signal }) {
  qsa(".js-view-invoice", root).forEach((button) => {
    button.addEventListener("click", () => {
      const state = store.getState();
      const invoice = visibleInvoiceRecords(state).find((item) => item.id === button.dataset.invoiceId);
      if (invoice) openInvoiceQuickView(invoice, state);
    });
  });

  qsa(".js-download-invoice", root).forEach((button) => {
    button.addEventListener("click", () => {
      const state = store.getState();
      const invoice = visibleInvoiceRecords(state).find((item) => item.id === button.dataset.invoiceId);
      if (invoice) downloadInvoice(invoice, state);
    });
  });

  qsa(".js-print-invoice", root).forEach((button) => {
    button.addEventListener("click", () => {
      const state = store.getState();
      const invoice = visibleInvoiceRecords(state).find((item) => item.id === button.dataset.invoiceId);
      if (invoice) printInvoice(invoice, state);
    });
  });

  const creditModal = qs("#rep-credit-invoice-modal", root);
  const creditForm = qs("#rep-credit-invoice-form", root);
  const creditError = qs("[data-rep-credit-invoice-error]", root);
  const creditSummary = qs("[data-rep-credit-invoice-summary]", root);

  function closeCreditInvoiceEditor() {
    if (creditModal) creditModal.hidden = true;
  }

  qsa(".js-edit-rep-credit-invoice", root).forEach((button) => {
    button.addEventListener("click", () => {
      if (!creditModal || !creditForm) return;
      const state = store.getState();
      const invoice = visibleInvoiceRecords(state).find((item) => item.id === button.dataset.invoiceId);
      if (!invoice || invoiceDocumentType(invoice, state) !== INVOICE_DOCUMENT_TYPES.REPRESENTATIVE_CUSTOMER_INVOICE) return;
      creditForm.elements.invoiceId.value = invoice.id;
      creditForm.elements.status.value = invoice.status === "paid" ? "paid" : "open";
      creditForm.elements.dueAt.value = String(invoice.dueAt || invoice.issuedAt || "").slice(0, 10);
      creditForm.elements.paymentNote.value = invoice.paymentNote || "";
      if (creditSummary) creditSummary.textContent = `${invoice.id} · ${invoice.customerName || "Customer"} · ${formatCurrency(invoice.amount)}`;
      if (creditError) creditError.textContent = "";
      creditModal.hidden = false;
      creditModal.focus();
    });
  });

  qsa(".js-close-rep-credit-invoice, [data-close-rep-credit-invoice]", root)
    .forEach((button) => button.addEventListener("click", closeCreditInvoiceEditor));
  creditModal?.addEventListener("keydown", (event) => {
    if (event.key === "Escape") closeCreditInvoiceEditor();
  });
  creditForm?.addEventListener("submit", (event) => {
    event.preventDefault();
    const formData = new FormData(creditForm);
    const invoiceId = String(formData.get("invoiceId") || "");
    const dueAt = String(formData.get("dueAt") || "");
    if (!invoiceId || !/^\d{4}-\d{2}-\d{2}$/.test(dueAt)) {
      if (creditError) creditError.textContent = "Choose a valid due date.";
      return;
    }
    store.dispatch({
      type: "UPDATE_REP_CREDIT_INVOICE",
      invoiceId,
      status: formData.get("status"),
      dueAt,
      paymentNote: formData.get("paymentNote"),
      message: formData.get("status") === "paid" ? "Credit invoice marked paid" : "Credit invoice updated"
    });
    closeCreditInvoiceEditor();
  });

  const rows = qsa("[data-rep-invoice-row]", root);
  const pagination = qs("[data-rep-invoice-pagination]", root);
  const status = qs("[data-rep-invoice-page-status]", root);
  const previous = qs('[data-rep-invoice-page="prev"]', root);
  const next = qs('[data-rep-invoice-page="next"]', root);
  const localSearch = qs("[data-invoice-filter]", root);
  const statusFilter = qs("[data-invoice-status-filter]", root);
  const documentFilter = qs("[data-invoice-document-filter]", root);
  const globalSearch = qs("#global-search", document);
  const printListButton = qs(".js-print-invoice-list", root);
  let currentPage = 1;

  function filteredInvoices() {
    const globalQuery = String(globalSearch?.value || "").trim().toLowerCase();
    const localQuery = String(localSearch?.value || "").trim().toLowerCase();
    const selectedStatus = String(statusFilter?.value || "all");
    const selectedDocument = String(documentFilter?.value || "all");

    return visibleInvoiceRecords(store.getState()).filter((invoice) => {
      const currentState = store.getState();
      const searchIndex = invoiceSearchIndex(invoice, currentState);
      const documentType = invoiceDocumentType(invoice, currentState);
      return (
        (!globalQuery || searchIndex.includes(globalQuery)) &&
        (!localQuery || searchIndex.includes(localQuery)) &&
        (selectedStatus === "all" || (invoice.status || "open") === selectedStatus) &&
        (selectedDocument === "all" || (selectedDocument === "customer_sales"
          ? CUSTOMER_SALE_DOCUMENT_TYPES.has(documentType)
          : documentType === selectedDocument))
      );
    });
  }

  printListButton?.addEventListener("click", () => {
    const invoices = filteredInvoices();
    const section = {
      title: "Invoices",
      headers: ["Document", "Issued", "Customer / recipient", "Products", "Document type", "Payment", "Total", "Status"],
      rows: invoices.map((invoice) => ({
        cells: [
          invoice.id,
          formatDate(invoice.issuedAt),
          invoice.customerName || "Customer",
          invoiceProductSummary(invoice),
          invoiceDocumentLabel(invoice, store.getState()),
          invoicePaymentLabel(invoice),
          formatCurrency(invoice.amount),
          statusText(invoice.status || "open")
        ]
      }))
    };

    printTabularReport({
      title: "DistroIQ Invoice List",
      subtitle: "Invoices shown by the selected filters",
      sections: [section],
      filename: `distroiq-invoice-list-${new Date().toISOString().slice(0, 10)}.html`
    });
  });

  if (!rows.length || !pagination || !status) return;

  function applyPage() {
    const globalQuery = String(globalSearch?.value || "").trim().toLowerCase();
    const localQuery = String(localSearch?.value || "").trim().toLowerCase();
    const selectedStatus = String(statusFilter?.value || "all");
    const selectedDocument = String(documentFilter?.value || "all");
    const visibleRows = rows.filter((row) => {
      const searchIndex = String(row.dataset.searchIndex || "");
      return (
        (!globalQuery || searchIndex.includes(globalQuery)) &&
        (!localQuery || searchIndex.includes(localQuery)) &&
        (selectedStatus === "all" || row.dataset.invoiceStatus === selectedStatus) &&
        (selectedDocument === "all" || (selectedDocument === "customer_sales"
          ? CUSTOMER_SALE_DOCUMENT_TYPES.has(row.dataset.invoiceDocumentType)
          : row.dataset.invoiceDocumentType === selectedDocument))
      );
    });
    const totalPages = Math.max(1, Math.ceil(visibleRows.length / INVOICE_PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    rows.forEach((row) => { row.hidden = true; });
    visibleRows.forEach((row, index) => { row.hidden = Math.floor(index / INVOICE_PAGE_SIZE) + 1 !== currentPage; });
    pagination.hidden = visibleRows.length <= INVOICE_PAGE_SIZE;
    status.textContent = `${formatNumber(visibleRows.length)} invoice${visibleRows.length === 1 ? "" : "s"} - page ${formatNumber(currentPage)} of ${formatNumber(totalPages)}`;
    if (printListButton) printListButton.disabled = !visibleRows.length;
    if (previous) previous.disabled = currentPage === 1;
    if (next) next.disabled = currentPage === totalPages;
  }

  previous?.addEventListener("click", () => { currentPage -= 1; applyPage(); });
  next?.addEventListener("click", () => { currentPage += 1; applyPage(); });
  localSearch?.addEventListener("input", () => { currentPage = 1; applyPage(); }, { signal });
  statusFilter?.addEventListener("change", () => { currentPage = 1; applyPage(); }, { signal });
  documentFilter?.addEventListener("change", () => { currentPage = 1; applyPage(); }, { signal });
  globalSearch?.addEventListener("input", () => { currentPage = 1; applyPage(); }, { signal });
  window.setTimeout(applyPage, 0);
}
