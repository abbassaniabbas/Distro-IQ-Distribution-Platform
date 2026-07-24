import { currencySymbolFor, formatDate, statusText } from "./formatters.js";
import { packagingQuantityLabel } from "./packaging.js";
import { isRepresentativeSellThroughInvoice } from "./calculations.js?v=20260722";
import { escapeHtml } from "../ui/dom.js";
import { icon } from "../ui/icons.js";

function dateOnly(value) {
  return String(value || "").slice(0, 10);
}

function addDays(value, days) {
  const date = new Date(`${dateOnly(value)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return dateOnly(value);
  date.setDate(date.getDate() + Number(days || 0));
  return date.toISOString().slice(0, 10);
}

function orderTotal(order) {
  return (order?.items || []).reduce((total, item) => (
    total + Number(item.lineAmount ?? (Number(item.quantity || 0) * Number(item.unitPrice ?? item.unitPriceAtSale ?? 0)))
  ), 0);
}

function invoiceStatus(invoice) {
  if (invoice.status === "recorded") return "recorded";
  if (invoice.status === "paid") return "paid";
  return invoice.dueAt && invoice.dueAt < new Date().toISOString().slice(0, 10) ? "overdue" : "open";
}

export function getInvoiceRecords(state) {
  const ordersById = new Map((state.orders || []).map((order) => [order.id, order]));
  const retailersById = new Map((state.retailers || []).map((retailer) => [retailer.id, retailer]));
  const explicitInvoices = (state.invoices || []).map((invoice) => {
    const order = ordersById.get(invoice.orderId);
    const retailer = retailersById.get(invoice.retailerId || order?.retailerId);
    const representativeSellThrough = isRepresentativeSellThroughInvoice(invoice, state);

    return {
      ...invoice,
      customerName: invoice.customerName || retailer?.name || order?.customerName || "Customer",
      customerAddress: invoice.customerAddress || retailer?.address || "",
      customerPhone: invoice.customerPhone || retailer?.contactPhone || "",
      collectedBy: invoice.collectedBy || (order?.source === "factory_dispatch" ? (invoice.customerName || order?.customerName || "Customer") : ""),
      paymentType: representativeSellThrough ? "not_tracked" : invoice.paymentType || order?.paymentType || "cash",
      repName: invoice.repName || order?.repName || "Sales Representative",
      repUserId: invoice.repUserId || order?.repUserId || "",
      items: invoice.items?.length ? invoice.items : (order?.items || []),
      amount: Number(invoice.amount ?? orderTotal(order)),
      financialImpact: invoice.financialImpact ?? order?.financialImpact ?? true,
      accountingTreatment: invoice.accountingTreatment || order?.accountingTreatment || "factory_revenue",
      documentType: invoice.documentType || order?.documentType || "invoice",
      status: representativeSellThrough ? "recorded" : invoiceStatus(invoice)
    };
  });
  const linkedOrderIds = new Set(explicitInvoices.map((invoice) => invoice.orderId).filter(Boolean));
  const limitsByName = new Map((state.creditLimits || []).map((limit) => [String(limit.partyName || "").trim().toLowerCase(), limit]));
  const derivedInvoices = (state.orders || [])
    .filter((order) => order.source === "quick_sale")
    .filter((order) => !order.invoiceDeleted)
    .filter((order) => !linkedOrderIds.has(order.id))
    .map((order) => {
      const retailer = retailersById.get(order.retailerId);
      const issuedAt = dateOnly(order.createdAt || order.updatedAt);
      const isCredit = String(order.paymentType || "").toLowerCase().includes("credit");
      const representativeSellThrough = isRepresentativeSellThroughInvoice({ orderId: order.id }, state);
      const limit = limitsByName.get(String(order.customerName || "").trim().toLowerCase());
      const dueAt = isCredit ? (dateOnly(order.dueAt) || addDays(issuedAt, limit?.paymentPeriodDays ?? 14)) : issuedAt;

      return {
        id: `INV-${order.id}`,
        clientId: state.client?.id || order.clientId || "",
        orderId: order.id,
        transactionId: order.transactionId || "",
        retailerId: order.retailerId || "",
        customerName: retailer?.name || order.customerName || "Customer",
        customerAddress: retailer?.address || "",
        customerPhone: retailer?.contactPhone || "",
        issuedAt,
        dueAt,
        amount: orderTotal(order),
        financialImpact: order.financialImpact ?? true,
        accountingTreatment: order.accountingTreatment || "factory_revenue",
        documentType: order.documentType || "invoice",
        status: representativeSellThrough ? "recorded" : invoiceStatus({ status: order.paymentStatus === "recorded" ? "recorded" : order.paymentStatus === "paid" ? "paid" : "open", dueAt }),
        paymentType: representativeSellThrough ? "not_tracked" : order.paymentType || "cash",
        repName: order.repName || "Sales Representative",
        repUserId: order.repUserId || "",
        items: order.items || [],
        derived: true
      };
    });

  return [...explicitInvoices, ...derivedInvoices]
    .sort((a, b) => String(b.issuedAt || "").localeCompare(String(a.issuedAt || "")) || String(b.id).localeCompare(String(a.id)));
}

export function getFinancialInvoiceRecords(state) {
  return getInvoiceRecords(state).filter((invoice) => !isRepresentativeSellThroughInvoice(invoice, state));
}

function money(value, client) {
  return `${currencySymbolFor(client)}${new Intl.NumberFormat("en-NG", { maximumFractionDigits: 2 }).format(Number(value || 0))}`;
}

function safeFilename(value) {
  return String(value || "invoice").replace(/[^a-z0-9_-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();
}

function invoiceLogo(client, companyName) {
  return client.logoDataUrl
    ? `<img src="${escapeHtml(client.logoDataUrl)}" alt="${escapeHtml(companyName)} logo">`
    : `<span class="invoice-modal-logo-fallback">${escapeHtml(companyName.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "DI")}</span>`;
}

function invoiceQuantityMarkup(item) {
  const baseQuantity = Number(item?.quantity || 0);
  const packagingType = item?.packagingType || "piece";
  const packagingQuantity = Number(item?.packagingQuantity || 0);
  if (packagingType === "piece" || !packagingQuantity) {
    return escapeHtml(baseQuantity);
  }

  return `${escapeHtml(packagingQuantityLabel(packagingQuantity, packagingType))}<br><span class="muted">${escapeHtml(baseQuantity)} pieces</span>`;
}

function invoiceUnitPrice(item) {
  if (item?.packagingType && item.packagingType !== "piece" && Number(item.packagingUnitPrice || 0) > 0) {
    return Number(item.packagingUnitPrice);
  }
  return Number(item?.unitPrice ?? item?.unitPriceAtSale ?? 0);
}

function isFactoryRepresentativeInvoice(invoice, state, sourceOrder) {
  const isFactoryDispatch = Boolean(invoice.dispatchId || sourceOrder?.source === "factory_dispatch");
  if (!isFactoryDispatch) return false;

  const recipientType = String(invoice.customerType || sourceOrder?.customerType || "").toLowerCase();
  if (recipientType.includes("representative")) return true;

  return (state.stockAssignments || []).some((assignment) => (
    (assignment.invoiceId && assignment.invoiceId === invoice.id) ||
    (assignment.dispatchId && assignment.dispatchId === (invoice.dispatchId || sourceOrder?.dispatchId))
  ));
}

export function buildInvoicePreviewContent(invoice, state) {
  const client = state.client || {};
  const companyName = client.documentBusinessName || client.companyName || "DistroIQ Company";
  const items = invoice.items || [];
  const total = Number(invoice.amount ?? items.reduce((sum, item) => (
    sum + Number(item.lineAmount ?? (Number(item.quantity || 0) * Number(item.unitPrice ?? item.unitPriceAtSale ?? 0)))
  ), 0));
  const isSalesReceipt = isRepresentativeSellThroughInvoice(invoice, state);
  const documentLabel = isSalesReceipt ? "Sales receipt" : "Invoice";
  const sourceOrder = (state.orders || []).find((order) => order.id === invoice.orderId);
  const isFactoryDispatch = Boolean(invoice.dispatchId || sourceOrder?.source === "factory_dispatch");
  const isFactoryRepresentativeDispatch = isFactoryRepresentativeInvoice(invoice, state, sourceOrder);
  const handlingLabel = isFactoryDispatch ? "Collected by" : "Sold by";
  const handlingName = isFactoryDispatch
    ? (invoice.collectedBy || invoice.customerName || "Customer")
    : (invoice.repName || "Sales Representative");

  return `
    <article class="invoice-modal-document">
      <header class="invoice-modal-document-header">
        <div class="invoice-modal-brand">
          ${invoiceLogo(client, companyName)}
          <div>
            <strong>${escapeHtml(companyName)}</strong>
            <span>DistroIQ Sales, Stock &amp; Distribution</span>
          </div>
        </div>
        <div class="invoice-modal-identity">
          <span class="eyebrow">${documentLabel}</span>
          <strong>${escapeHtml(invoice.id)}</strong>
          <span class="invoice-modal-status ${escapeHtml(invoice.status)}">${escapeHtml(statusText(invoice.status))}</span>
        </div>
      </header>

      <div class="invoice-modal-details">
        <section>
          <span>Bill to</span>
          <strong>${escapeHtml(invoice.customerName || "Customer")}</strong>
          ${isFactoryRepresentativeDispatch ? '<small class="invoice-modal-origin-note">From factory</small>' : ""}
          ${invoice.customerAddress ? `<p>${escapeHtml(invoice.customerAddress)}</p>` : ""}
          ${invoice.customerPhone ? `<p>${escapeHtml(invoice.customerPhone)}</p>` : ""}
        </section>
        <section>
          <span>${documentLabel} details</span>
          <dl>
            <div><dt>Issued</dt><dd>${escapeHtml(formatDate(invoice.issuedAt))}</dd></div>
            ${isSalesReceipt ? "" : `<div><dt>Due</dt><dd>${escapeHtml(formatDate(invoice.dueAt))}</dd></div>`}
            ${isSalesReceipt ? "" : `<div><dt>Payment</dt><dd>${escapeHtml(statusText(invoice.paymentType))}</dd></div>`}
            <div><dt>${handlingLabel}</dt><dd>${escapeHtml(handlingName)}</dd></div>
          </dl>
        </section>
      </div>

      <div class="invoice-modal-lines">
        <table>
          <thead><tr><th>Product</th><th>Quantity</th><th>Unit price</th><th>Amount</th></tr></thead>
          <tbody>
            ${items.map((item) => {
              const unitPrice = Number(item.unitPrice ?? item.unitPriceAtSale ?? 0);
              const lineTotal = Number(item.lineAmount ?? (Number(item.quantity || 0) * unitPrice));
              return `
                <tr>
                  <td><strong>${escapeHtml(item.productName || item.productId || "Product")}</strong></td>
                  <td>${invoiceQuantityMarkup(item)}</td>
                  <td>${escapeHtml(money(invoiceUnitPrice(item), client))}</td>
                  <td>${escapeHtml(money(lineTotal, client))}</td>
                </tr>
              `;
            }).join("") || '<tr><td colspan="4">No product lines recorded</td></tr>'}
          </tbody>
        </table>
      </div>

      <div class="invoice-modal-total">
        <span>Total</span>
        <strong>${escapeHtml(money(total, client))}</strong>
      </div>

      <footer class="invoice-modal-footer">
        <span>Generated by DistroIQ</span>
        <span>${escapeHtml(companyName)}</span>
      </footer>
    </article>
  `;
}

export function buildInvoiceDocument(invoice, state, options = {}) {
  const client = state.client || {};
  const companyName = client.documentBusinessName || client.companyName || "DistroIQ Company";
  const items = invoice.items || [];
  const total = Number(invoice.amount ?? items.reduce((sum, item) => sum + Number(item.lineAmount ?? (Number(item.quantity || 0) * Number(item.unitPrice || 0))), 0));
  const isSalesReceipt = isRepresentativeSellThroughInvoice(invoice, state);
  const documentLabel = isSalesReceipt ? "SALES RECEIPT" : "INVOICE";
  const sourceOrder = (state.orders || []).find((order) => order.id === invoice.orderId);
  const isFactoryDispatch = Boolean(invoice.dispatchId || sourceOrder?.source === "factory_dispatch");
  const isFactoryRepresentativeDispatch = isFactoryRepresentativeInvoice(invoice, state, sourceOrder);
  const handlingLabel = isFactoryDispatch ? "Collected by" : "Sold by";
  const handlingName = isFactoryDispatch
    ? (invoice.collectedBy || invoice.customerName || "Customer")
    : (invoice.repName || "Sales Representative");
  const logo = client.logoDataUrl
    ? `<img src="${escapeHtml(client.logoDataUrl)}" alt="${escapeHtml(companyName)} logo">`
    : `<div class="logo-fallback">${escapeHtml(companyName.split(/\s+/).slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "DI")}</div>`;

  return `<!doctype html>
    <html lang="en">
      <head>
        <meta charset="utf-8">
        <meta name="viewport" content="width=device-width, initial-scale=1">
        <title>${escapeHtml(invoice.id)} - ${documentLabel}</title>
        <style>
          * { box-sizing: border-box; }
          body { margin: 0; background: #eef3f5; color: #10243f; font-family: Arial, sans-serif; }
          .invoice { width: min(820px, calc(100% - 32px)); margin: 28px auto; padding: 34px; background: #fff; border-top: 6px solid #19a974; box-shadow: 0 16px 45px rgba(16,36,63,.12); }
          header { display: flex; justify-content: space-between; gap: 24px; padding-bottom: 24px; border-bottom: 1px solid #dce6eb; }
          .brand { display: flex; align-items: center; gap: 14px; }
          .brand img, .logo-fallback { width: 58px; height: 58px; object-fit: contain; border: 1px solid #dce6eb; border-radius: 6px; }
          .logo-fallback { display: grid; place-items: center; background: #e9f8f2; color: #0b7252; font-weight: 800; }
          h1, h2, p { margin: 0; }
          .brand h2 { font-size: 18px; }
          .brand p, .muted { color: #657487; font-size: 12px; }
          .invoice-title { text-align: right; }
          .invoice-title h1 { font-size: 28px; }
          .status { display: inline-block; margin-top: 7px; padding: 5px 8px; background: #e9f8f2; color: #0b7252; font-size: 11px; font-weight: 800; text-transform: uppercase; }
          .details { display: grid; grid-template-columns: 1fr 1fr; gap: 24px; padding: 24px 0; }
          .details section { display: grid; gap: 5px; }
          .details h2 { margin-bottom: 5px; color: #657487; font-size: 11px; text-transform: uppercase; }
          .details strong { font-size: 14px; }
          .origin-note { font-size: 10px; font-weight: 700; }
          table { width: 100%; border-collapse: collapse; }
          th, td { padding: 11px 9px; border-bottom: 1px solid #dce6eb; text-align: left; font-size: 12px; }
          th { background: #f4f8f9; color: #657487; font-size: 10px; text-transform: uppercase; }
          th:nth-child(n+2), td:nth-child(n+2) { text-align: right; }
          .total { display: flex; justify-content: flex-end; padding: 22px 0; }
          .total div { display: flex; justify-content: space-between; gap: 50px; min-width: 260px; padding-top: 12px; border-top: 2px solid #10243f; font-size: 17px; }
          footer { display: flex; justify-content: space-between; gap: 20px; padding-top: 20px; border-top: 1px solid #dce6eb; color: #657487; font-size: 11px; }
          ${options.preview ? `
            body { background: #fff; }
            .invoice { width: 100%; min-height: 100vh; margin: 0; box-shadow: none; }
          ` : ""}
          @media print { body { background: #fff; } .invoice { width: 100%; margin: 0; box-shadow: none; } }
          @media (max-width: 600px) { .invoice { padding: 22px; } header, footer { flex-direction: column; } .invoice-title { text-align: left; } .details { grid-template-columns: 1fr; } }
        </style>
      </head>
      <body>
        <main class="invoice">
          <header>
            <div class="brand">${logo}<div><h2>${escapeHtml(companyName)}</h2><p>DistroIQ Sales, Stock &amp; Distribution</p></div></div>
            <div class="invoice-title"><h1>${documentLabel}</h1><p>${escapeHtml(invoice.id)}</p><span class="status">${escapeHtml(statusText(invoice.status))}</span></div>
          </header>
          <div class="details">
            <section><h2>Bill to</h2><strong>${escapeHtml(invoice.customerName || "Customer")}</strong>${isFactoryRepresentativeDispatch ? '<p class="muted origin-note">From factory</p>' : ""}${invoice.customerAddress ? `<p class="muted">${escapeHtml(invoice.customerAddress)}</p>` : ""}${invoice.customerPhone ? `<p class="muted">${escapeHtml(invoice.customerPhone)}</p>` : ""}</section>
            <section><h2>Sale details</h2><strong>${handlingLabel} ${escapeHtml(handlingName)}</strong><p class="muted">Issued ${escapeHtml(formatDate(invoice.issuedAt))}</p>${isSalesReceipt ? "" : `<p class="muted">Payment: ${escapeHtml(statusText(invoice.paymentType))}</p><p class="muted">Due: ${escapeHtml(formatDate(invoice.dueAt))}</p>`}</section>
          </div>
          <table><thead><tr><th>Product</th><th>Quantity</th><th>Unit price</th><th>Amount</th></tr></thead><tbody>${items.map((item) => {
            const lineTotal = Number(item.lineAmount ?? (Number(item.quantity || 0) * Number(item.unitPrice ?? item.unitPriceAtSale ?? 0)));
            return `<tr><td>${escapeHtml(item.productName || item.productId || "Product")}</td><td>${invoiceQuantityMarkup(item)}</td><td>${escapeHtml(money(invoiceUnitPrice(item), client))}</td><td>${escapeHtml(money(lineTotal, client))}</td></tr>`;
          }).join("") || '<tr><td colspan="4">No product lines recorded</td></tr>'}</tbody></table>
          <div class="total"><div><strong>Total</strong><strong>${escapeHtml(money(total, client))}</strong></div></div>
          <footer><span>Generated by DistroIQ</span><span>${escapeHtml(companyName)}</span></footer>
        </main>
      </body>
    </html>`;
}

export function downloadInvoice(invoice, state) {
  const blob = new Blob([buildInvoiceDocument(invoice, state)], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${safeFilename(invoice.id)}.html`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function buildInvoiceQuickViewMarkup(invoice, state, options = {}) {
  const isSalesReceipt = isRepresentativeSellThroughInvoice(invoice, state);
  const downloadLabel = options.downloadLabel || "Download invoice";
  const downloadIconName = options.downloadIconName || "download";

  return `
    <section class="stock-modal invoice-preview-modal" role="dialog" aria-modal="true" aria-labelledby="invoice-preview-title">
      <header class="stock-modal-header">
        <div>
          <span class="eyebrow">${isSalesReceipt ? "Sales receipt" : "Invoice quick view"}</span>
          <h2 id="invoice-preview-title">${escapeHtml(invoice.id)}</h2>
        </div>
        <div class="invoice-preview-actions">
          <button class="icon-button js-download-invoice-preview" type="button" title="${escapeHtml(downloadLabel)}" aria-label="${escapeHtml(downloadLabel)}">
            ${icon(downloadIconName)}
          </button>
          <button class="icon-button js-print-invoice-preview" type="button" title="Print invoice" aria-label="Print invoice">
            ${icon("print")}
          </button>
          <button class="icon-button js-close-invoice-preview" type="button" title="Close invoice" aria-label="Close invoice">
            ${icon("x")}
          </button>
        </div>
      </header>
      <div class="invoice-preview-body">
        ${buildInvoicePreviewContent(invoice, state)}
      </div>
    </section>
  `;
}

export function openInvoiceQuickView(invoice, state, options = {}) {
  document.querySelector("#invoice-quick-view")?.remove();

  const backdrop = document.createElement("div");
  backdrop.id = "invoice-quick-view";
  backdrop.className = "stock-modal-backdrop invoice-preview-backdrop";
  backdrop.tabIndex = -1;
  backdrop.innerHTML = buildInvoiceQuickViewMarkup(invoice, state, options);

  document.body.appendChild(backdrop);

  function closePreview() {
    document.removeEventListener("keydown", handleKeydown);
    backdrop.remove();
  }

  function handleKeydown(event) {
    if (event.key === "Escape") closePreview();
  }

  backdrop.querySelector(".js-close-invoice-preview")?.addEventListener("click", closePreview);
  backdrop.querySelector(".js-download-invoice-preview")?.addEventListener("click", () => downloadInvoice(invoice, state));
  backdrop.querySelector(".js-print-invoice-preview")?.addEventListener("click", () => printInvoice(invoice, state));
  backdrop.addEventListener("click", (event) => {
    if (event.target === backdrop) closePreview();
  });
  document.addEventListener("keydown", handleKeydown);
  backdrop.querySelector(".js-close-invoice-preview")?.focus();
}

export function printInvoice(invoice, state) {
  const invoiceWindow = window.open("", "_blank");
  if (!invoiceWindow) {
    downloadInvoice(invoice, state);
    return;
  }

  invoiceWindow.document.write(buildInvoiceDocument(invoice, state));
  invoiceWindow.document.close();
  invoiceWindow.focus();
  invoiceWindow.print();
}
