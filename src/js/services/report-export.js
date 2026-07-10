function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function reportHtml({ title, subtitle = "", sections = [] }) {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8">
        <title>${escapeHtml(title)}</title>
        <style>
          body { font-family: Arial, sans-serif; color: #102235; margin: 28px; }
          h1 { color: #0b1f3a; font-size: 20px; margin: 0 0 5px; }
          h2 { color: #0b1f3a; font-size: 14px; margin: 22px 0 8px; }
          p { color: #607080; font-size: 11px; margin: 0 0 18px; }
          table { border-collapse: collapse; margin-bottom: 18px; width: 100%; }
          th, td { border: 1px solid #dde6e3; font-size: 10px; padding: 7px; text-align: left; }
          th { background: #e8f7f1; color: #0b1f3a; }
          tr.is-variance td { color: #b42318; font-weight: 700; }
          @page { margin: 16mm; size: landscape; }
        </style>
      </head>
      <body>
        <h1>${escapeHtml(title)}</h1>
        <p>${escapeHtml(subtitle || `Generated ${new Date().toLocaleString()}`)}</p>
        ${sections.map((section) => `
          ${section.title ? `<h2>${escapeHtml(section.title)}</h2>` : ""}
          <table>
            <thead><tr>${section.headers.map((header) => `<th>${escapeHtml(header)}</th>`).join("")}</tr></thead>
            <tbody>
              ${section.rows.map((row) => `
                <tr class="${row.isVariance ? "is-variance" : ""}">
                  ${row.cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}
                </tr>
              `).join("")}
            </tbody>
          </table>
        `).join("")}
      </body>
    </html>
  `;
}

function downloadHtml(filename, html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export function printTabularReport({ title, subtitle, sections, filename }) {
  if (!sections?.some((section) => section.rows?.length)) return false;

  const html = reportHtml({ title, subtitle, sections });
  const reportWindow = window.open("", "_blank");

  if (!reportWindow) {
    downloadHtml(filename || "distroiq-report.html", html);
    return true;
  }

  reportWindow.document.write(html);
  reportWindow.document.close();
  reportWindow.focus();
  reportWindow.print();
  return true;
}
