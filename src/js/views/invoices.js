import { downloadInvoice, getInvoiceRecords, openInvoiceQuickView, printInvoice } from "../services/invoices.js";
import { formatCurrency, formatDate, formatNumber, statusText } from "../services/formatters.js";
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

function renderInvoiceRows(invoices) {
  return invoices.map((invoice, index) => `
    <tr ${index >= INVOICE_PAGE_SIZE ? "hidden " : ""}data-rep-invoice-row data-search-index="${escapeHtml(`${invoice.id} ${invoice.customerName} ${invoice.repName} ${invoice.paymentType} ${invoiceProductSummary(invoice)}`.toLowerCase())}">
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
  const today = new Date().toISOString().slice(0, 10);
  const todayInvoices = invoices.filter((invoice) => invoice.issuedAt === today);
  const totalValue = invoices.reduce((total, invoice) => total + Number(invoice.amount || 0), 0);
  const openValue = invoices.filter((invoice) => invoice.status !== "paid").reduce((total, invoice) => total + Number(invoice.amount || 0), 0);

  return `
    <section class="view invoices-view">
      <div class="metric-grid invoice-metrics">
        ${metricCard({ label: "My invoices", value: formatNumber(invoices.length), meta: "Cash and credit sales", iconName: "orders" })}
        ${metricCard({ label: "Today", value: formatNumber(todayInvoices.length), meta: "Invoices created today", iconName: "clock" })}
        ${metricCard({ label: "Total sales", value: formatCurrency(totalValue), meta: "Value on all my invoices", iconName: "finance" })}
        ${metricCard({ label: "Still unpaid", value: formatCurrency(openValue), meta: "Credit invoices awaiting payment", iconName: "wallet" })}
      </div>
      <section class="panel">
        ${panelHeader("My invoices", "Download or print a customer invoice after recording a sale")}
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
  const globalSearch = qs("#global-search", document);
  let currentPage = 1;

  if (!rows.length || !pagination || !status) return;

  function applyPage() {
    const query = String(globalSearch?.value || "").trim().toLowerCase();
    const visibleRows = rows.filter((row) => !query || String(row.dataset.searchIndex || "").includes(query));
    const totalPages = Math.max(1, Math.ceil(visibleRows.length / INVOICE_PAGE_SIZE));
    currentPage = Math.min(Math.max(1, currentPage), totalPages);
    rows.forEach((row) => { row.hidden = true; });
    visibleRows.forEach((row, index) => { row.hidden = Math.floor(index / INVOICE_PAGE_SIZE) + 1 !== currentPage; });
    pagination.hidden = visibleRows.length <= INVOICE_PAGE_SIZE;
    status.textContent = `${formatNumber(visibleRows.length)} invoice${visibleRows.length === 1 ? "" : "s"} - page ${formatNumber(currentPage)} of ${formatNumber(totalPages)}`;
    if (previous) previous.disabled = currentPage === 1;
    if (next) next.disabled = currentPage === totalPages;
  }

  previous?.addEventListener("click", () => { currentPage -= 1; applyPage(); });
  next?.addEventListener("click", () => { currentPage += 1; applyPage(); });
  globalSearch?.addEventListener("input", () => { currentPage = 1; applyPage(); }, { signal });
  window.setTimeout(applyPage, 0);
}
