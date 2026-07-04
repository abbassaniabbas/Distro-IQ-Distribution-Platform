import { getBrandColor } from "../services/branding.js";
import { formatCurrency } from "../services/formatters.js";
import { escapeHtml } from "./dom.js";

function companyInitials(companyName) {
  return (companyName || "DI")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
}

function renderPreviewLogo(client) {
  if (client?.logoDataUrl) {
    return `<img src="${client.logoDataUrl}" alt="">`;
  }

  return `<span>${escapeHtml(companyInitials(client?.companyName))}</span>`;
}

export function renderDeliveryNotePreview(client) {
  const brandColor = getBrandColor(client);
  const companyName = client?.companyName || "DistroIQ";
  const sampleRows = [
    {
      item: "Crunchy Plantain Chips 50g",
      quantity: 240,
      amount: 72000
    },
    {
      item: "Cheese Corn Puffs 35g",
      quantity: 180,
      amount: 39600
    }
  ];
  const total = sampleRows.reduce((sum, row) => sum + row.amount, 0);

  return `
    <article class="delivery-note-preview" style="--brand-color: ${escapeHtml(brandColor)}">
      <div class="delivery-note-accent"></div>
      <header>
        <div class="delivery-note-brand">
          <div class="delivery-note-logo">${renderPreviewLogo(client)}</div>
          <div>
            <span class="eyebrow">Delivery note</span>
            <strong>${escapeHtml(companyName)}</strong>
          </div>
        </div>
        <div class="delivery-note-meta">
          <strong>DN-SAMPLE</strong>
          <span>Jul 4, 2026</span>
        </div>
      </header>

      <div class="delivery-note-party">
        <span class="eyebrow">Deliver to</span>
        <strong>Lekki Family Mart</strong>
        <span class="muted">Lagos, South West</span>
      </div>

      <div class="delivery-note-lines">
        ${sampleRows
          .map(
            (row) => `
              <div>
                <span>${escapeHtml(row.item)}</span>
                <strong>${escapeHtml(String(row.quantity))}</strong>
                <strong>${formatCurrency(row.amount)}</strong>
              </div>
            `
          )
          .join("")}
      </div>

      <footer>
        <span class="muted">Sample preview</span>
        <strong>${formatCurrency(total)}</strong>
      </footer>
    </article>
  `;
}
