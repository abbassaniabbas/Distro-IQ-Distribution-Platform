import { calculateMetrics, getInvoiceAging, getRetailerMap } from "../services/calculations.js";
import { formatCurrency, formatDate } from "../services/formatters.js";
import { escapeHtml, qsa } from "../ui/dom.js";
import { metricCard, panelHeader, progressBar, statusPill, table, textButton } from "../ui/components.js";

function renderAgingRows(invoices) {
  return getInvoiceAging(invoices)
    .map(
      (bucket) => `
        <div class="aging-row" data-search-index="${escapeHtml(bucket.label.toLowerCase())}">
          <strong>${escapeHtml(bucket.label)}</strong>
          ${progressBar(bucket.percent, bucket.label === "31+ days" ? "danger" : "good")}
          <span class="strong">${formatCurrency(bucket.total)}</span>
        </div>
      `
    )
    .join("");
}

function renderInvoiceRows(state) {
  const retailerMap = getRetailerMap(state.retailers);

  return state.invoices.map((invoice) => {
    const retailer = retailerMap.get(invoice.retailerId);
    const searchIndex = [
      invoice.id,
      retailer?.name,
      invoice.status,
      invoice.dueAt
    ]
      .join(" ")
      .toLowerCase();

    return `
      <tr data-search-index="${escapeHtml(searchIndex)}">
        <td>
          <strong>${escapeHtml(invoice.id)}</strong>
          <div class="muted">Issued ${formatDate(invoice.issuedAt)}</div>
        </td>
        <td>${escapeHtml(retailer?.name || "Unknown retailer")}</td>
        <td>${statusPill(invoice.status)}</td>
        <td>${formatDate(invoice.dueAt)}</td>
        <td>${formatCurrency(invoice.amount)}</td>
        <td>
          <div class="row-actions">
            ${textButton({
              iconName: "check",
              label: invoice.status === "paid" ? "Paid" : "Mark paid",
              className: invoice.status === "paid" ? "" : "primary js-mark-paid",
              disabled: invoice.status === "paid",
              data: { "invoice-id": invoice.id }
            })}
          </div>
        </td>
      </tr>
    `;
  });
}

export function renderFinance({ state }) {
  const metrics = calculateMetrics(state);
  const paidTotal = state.invoices
    .filter((invoice) => invoice.status === "paid")
    .reduce((total, invoice) => total + invoice.amount, 0);
  const overdueTotal = state.invoices
    .filter((invoice) => invoice.status === "overdue")
    .reduce((total, invoice) => total + invoice.amount, 0);

  return `
    <section class="view finance-view">
      <div class="finance-kpis">
        ${metricCard({
          label: "Receivables",
          value: formatCurrency(metrics.receivables),
          meta: "Open invoice balance",
          iconName: "wallet"
        })}
        ${metricCard({
          label: "Collected",
          value: formatCurrency(paidTotal),
          meta: "Confirmed payments",
          iconName: "check"
        })}
        ${metricCard({
          label: "Overdue",
          value: formatCurrency(overdueTotal),
          meta: "Needs collection follow-up",
          iconName: "alert"
        })}
      </div>

      <div class="finance-layout">
        <section class="panel">
          ${panelHeader("Receivables aging", "Open balances by due-date bucket")}
          <div class="aging-list">${renderAgingRows(state.invoices)}</div>
        </section>

        <section class="panel">
          ${panelHeader("Invoices", "Payment status by retailer")}
          ${table(
            ["Invoice", "Retailer", "Status", "Due", "Amount", ""],
            renderInvoiceRows(state),
            "No invoices available"
          )}
        </section>
      </div>
    </section>
  `;
}

export function bindFinance({ root, store }) {
  qsa(".js-mark-paid", root).forEach((button) => {
    button.addEventListener("click", () => {
      store.dispatch({
        type: "MARK_INVOICE_PAID",
        invoiceId: button.dataset.invoiceId,
        message: "Invoice marked paid"
      });
    });
  });
}
