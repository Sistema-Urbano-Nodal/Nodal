// Apply only trusted, server-owned flags to page templates. The homepage and
// recovery pages have no pilot banner and pass through unchanged.
export function preparePageHtml(html, { pilotMode = true } = {}) {
  if (!html.includes('data-pilot-banner')) return html;
  return html.replace(/<html\b([^>]*)>/i, (_, attributes) =>
    `<html${attributes.replace(/\sdata-pilot="[^"]*"/g, '')} data-pilot="${Boolean(pilotMode)}">`)
    .replace(/<div\b[^>]*\bdata-pilot-banner\b[^>]*>/g, tag => {
      const visible = tag.replace(/\shidden(?:="[^"]*")?/g, '');
      return pilotMode ? visible : visible.replace(/>$/, ' hidden>');
    });
}
