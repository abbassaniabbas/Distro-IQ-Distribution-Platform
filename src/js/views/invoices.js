import { downloadInvoice, getInvoiceRecords, openInvoiceQuickView, printInvoice } from "../services/invoices.js";
import { formatCurrency, formatDate, formatNumber, statusText } from "../services/formatters.js";
import { printTabularReport } from "../services/report-export.js";
import { currentUserRole } from "../services/rbac.js";
import { escapeHtml, qs, qsa } from "../ui/dom.js";
import { iconButton, metricCard, panelHeader, statusPill, table } from "../ui/components.js";

const INVOICE_PAGE_SIZE = 10;

function invoiceProductSummary(invoice) {
  const items = invoice.items || [];
  if (!items.length) return "No product details";
  const first = items[0];
  const remaining = items.length - 1;
  return `${first.productName || first.productId || "Product"}${remaining ? ` +${remaining} more` : ""}`;
}

function invoiceSearchIndex(invoice) {
  return `${invoice.id} ${invoice.customerName} ${invoice.repName} ${invoice.paymentType} ${invoice.status} ${invoiceProductSummary(invoice)}`.toLowerCase();
}

function renderInvoiceRows(invoices) {
  return invoices.map((invoice, index) => `
    <tr ${index >= INVOICE_PAGE_SIZE ? "hidden " : ""}data-rep-invoice-row data-invoice-status="${escapeHtml(invoice.status || "open")}" data-search-index="${escapeHtml(invoiceSearchIndex(invoice))}">
      <td><strong>${escapeHtml(invoice.id)}</strong><div class="muted">${formatDate(invoice.issuedAt)}</div></td>
      <td>${escapeHtml(invoice.customerName || "Customer")}</td>
      <td>${escapeHtml(invoiceProductSummary(invoice))}</td>
      <td>${escapeHtml(statusText(invoice.paymentType || "cash"))}</td>
      <td>${formatCurrency(invoice.amount)}</td>
      <td>${statusPill(invoice.status)}</td>
      <td>
        <div class="row-actions invoice-row-actions">
          ${iconButton({ iconName: "eye", label: "View", className: "js-view-invoice", data: { "invoice-id": invoice.id } })}
          ${iconButton({ iconName: "download", label: "Download", className: "js-download-invoice", data: { "invoice-id": invoice.id } })}
          ${iconButton({ iconName: "print", label: "Print", className: "js-print-invoice", data: { "invoice-id": invoice.id } })}
        </div>
      </td>
    </tr>
  `);
}

export function renderInvoices({ state }) {
  const invoices = getInvoiceRecords(state);
  const isRepresentative = currentUserRole(state) === "sales_rep";
  const heading = isRepresentative ? "My invoices" : "Invoices";
  const today = new Date().toISOString().slice(0, 10);
  const todayInvoices = invoices.filter((invoice) => invoice.issuedAt === today);
  const totalValue = invoices.reduce((total, invoice) => total + Number(invoice.amount || 0), 0);
  const openValue = invoices.filter((invoice) => invoice.status !== "paid").reduce((total, invoice) => total + Number(invoice.amount || 0), 0);

  return `
    <section class="view invoices-view">
      <div class="metric-grid invoice-metrics">
        ${metricCard({ label: heading, value: formatNumber(invoices.length), meta: "Cash and credit sales", iconName: "orders" })}
        ${metricCard({ label: "Today", value: formatNumber(todayInvoices.length), meta: "Invoices created today", iconName: "clock" })}
        ${metricCard({ label: "Total sales", value: formatCurrency(totalValue), meta: "Value on all my invoices", iconName: "finance" })}
        ${metricCard({ label: "Still unpaid", value: formatCurrency(openValue), meta: "Credit invoices awaiting payment", iconName: "wallet" })}
      </div>
      <section class="panel">
        ${panelHeader(
          heading,
          "Download or print a customer invoice after recording a sale",
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
              <option value="open">Open</option>
              <option value="overdue">Overdue</option>
            </select>
          </label>
        </div>
        ${table(
          ["Invoice", "Customer", "Products", "Payment", "Total", "Status", "Actions"],
          renderInvoiceRows(invoices),
          "No invoices yet. An invoice will appear after you record a sale."
        )}
        <div class="activity-pagination" data-rep-invoice-pagination hidden>
          <button class="button" type="button" data-rep-invoice-page="prev">Previous</button>
          <span data-rep-invoice-page-status>Page 1 of 1</span>
          <button class="button" type="button" data-rep-invoice-page="next">Next</button>
        </div>
      </section>
    </section>
  `;
}

export function bindInvoices({ root, store, signal }) {
  qsa(".js-view-invoice", root).forEach((button) => {
    button.addEventListener("click", () => {
      const state = store.getState();
      const invoice = getInvoiceRecords(state).find((item) => item.id === button.dataset.invoiceId);
      if (invoice) openInvoiceQuickView(invoice, state);
    });
  });

  qsa(".js-download-invoice", root).forEach((button) => {
    button.addEventListener("click", () => {
      const state = store.getState();
      const invoice = getInvoiceRecords(state).find((item) => item.id === button.dataset.invoiceId);
      if (invoice) downloadInvoice(invoice, state);
    });
  });

  qsa(".js-print-invoice", root).forEach((button) => {
    button.addEventListener("click", () => {
      const state = store.getState();
      const invoice = getInvoiceRecords(state).find((item) => item.id === button.dataset.invoiceId);
      if (invoice) printInvoice(invoice, state);
    });
  });

  const rows = qsa("[data-rep-invoice-row]", root);
  const pagination = qs("[data-rep-invoice-pagination]", root);
  const status = qs("[data-rep-invoice-page-status]", root);
  const previous = qs('[data-rep-invoice-page="prev"]', root);
  const next = qs('[data-rep-invoice-page="next"]', root);
  const localSearch = qs("[data-invoice-filter]", root);
  const statusFilter = qs("[data-invoice-status-filter]", root);
  const globalSearch = qs("#global-search", document);
  const printListButton = qs(".js-print-invoice-list", root);
  let currentPage = 1;

  function filteredInvoices() {
    const globalQuery = String(globalSearch?.value || "").trim().toLowerCase();
    const localQuery = String(localSearch?.value || "").trim().toLowerCase();
    const selectedStatus = String(statusFilter?.value || "all");

    return getInvoiceRecords(store.getState()).filter((invoice) => {
      const searchIndex = invoiceSearchIndex(invoice);
      return (
        (!globalQuery || searchIndex.includes(globalQuery)) &&
        (!localQuery || searchIndex.includes(localQuery)) &&
        (selectedStatus === "all" || (invoice.status || "open") === selectedStatus)
      );
    });
  }

  printListButton?.addEventListener("click", () => {
    const invoices = filteredInvoices();
    const section = {
      title: "Invoices",
      headers: ["Invoice", "Issued", "Customer", "Products", "Payment", "Total", "Status"],
      rows: invoices.map((invoice) => ({
        cells: [
          invoice.id,
          formatDate(invoice.issuedAt),
          invoice.customerName || "Customer",
          invoiceProductSummary(invoice),
          statusText(invoice.paymentType || "cash"),
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
    const visibleRows = rows.filter((row) => {
      const searchIndex = String(row.dataset.searchIndex || "");
      return (
        (!globalQuery || searchIndex.includes(globalQuery)) &&
        (!localQuery || searchIndex.includes(localQuery)) &&
        (selectedStatus === "all" || row.dataset.invoiceStatus === selectedStatus)
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
  globalSearch?.addEventListener("input", () => { currentPage = 1; applyPage(); }, { signal });
  window.setTimeout(applyPage, 0);
}
