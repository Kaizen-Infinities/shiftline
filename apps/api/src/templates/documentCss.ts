/**
 * Static stylesheet for the invoice and PO invoice templates. It replaces the runtime Tailwind
 * CDN script: the PDF renderer runs with JavaScript disabled and with every network request
 * blocked, so the CSS has to be inline. It contains only the utility classes those two
 * templates use (plus the small part of Tailwind's preflight they rely on). When you add a
 * class to either template, add its rule here.
 */
export const DOCUMENT_CSS = `
*, ::before, ::after { box-sizing: border-box; border: 0 solid #e5e7eb; }
html { line-height: 1.5; -webkit-text-size-adjust: 100%; font-family: sans-serif; }
body { margin: 0; line-height: inherit; font-family: sans-serif; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
h1 { font-size: inherit; font-weight: inherit; margin: 0; }
table { text-indent: 0; border-color: inherit; border-collapse: collapse; }
th, td { padding: 0; }
img { display: block; max-width: 100%; height: auto; }

.bg-white { background-color: #fff; }
.bg-\\[\\#f7f7f7\\] { background-color: #f7f7f7; }
.text-black { color: #000; }
.text-red-600 { color: #dc2626; }
.text-red-700 { color: #b91c1c; }
.text-slate-500 { color: #64748b; }
.text-slate-800 { color: #1e293b; }

.p-2 { padding: 0.5rem; }
.p-8 { padding: 2rem; }
.px-2 { padding-left: 0.5rem; padding-right: 0.5rem; }
.px-3 { padding-left: 0.75rem; padding-right: 0.75rem; }
.py-1 { padding-top: 0.25rem; padding-bottom: 0.25rem; }
.py-2 { padding-top: 0.5rem; padding-bottom: 0.5rem; }
.py-4 { padding-top: 1rem; padding-bottom: 1rem; }
.pb-2 { padding-bottom: 0.5rem; }
.pt-1 { padding-top: 0.25rem; }
.pt-2 { padding-top: 0.5rem; }
.m-0 { margin: 0; }
.mx-auto { margin-left: auto; margin-right: auto; }
.mb-1 { margin-bottom: 0.25rem; }
.mt-1 { margin-top: 0.25rem; }
.mt-2 { margin-top: 0.5rem; }
.mt-6 { margin-top: 1.5rem; }
.space-y-0\\.5 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.125rem; }
.space-y-1 > :not([hidden]) ~ :not([hidden]) { margin-top: 0.25rem; }

.border { border-width: 1px; }
.border-\\[1\\.5px\\] { border-width: 1.5px; }
.border-t { border-top-width: 1px; }
.border-t-\\[1\\.5px\\] { border-top-width: 1.5px; }
.border-b-\\[1\\.5px\\] { border-bottom-width: 1.5px; }
.border-r { border-right-width: 1px; }
.border-r-\\[1\\.5px\\] { border-right-width: 1.5px; }
.border-black { border-color: #000; }
.border-collapse { border-collapse: collapse; }
.box-border { box-sizing: border-box; }

.flex { display: flex; }
.flex-1 { flex: 1 1 0%; }
.flex-col { flex-direction: column; }
.shrink-0 { flex-shrink: 0; }
.items-center { align-items: center; }
.items-start { align-items: flex-start; }
.justify-between { justify-content: space-between; }
.gap-3 { gap: 0.75rem; }
.align-middle { vertical-align: middle; }
.break-all { word-break: break-all; }

.w-full { width: 100%; }
.w-\\[110px\\] { width: 110px; }
.max-w-5xl { max-width: 64rem; }
.max-w-\\[800px\\] { max-width: 800px; }

.font-\\[Arial\\,sans-serif\\] { font-family: Arial, sans-serif; }
.font-mono { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; }
.font-medium { font-weight: 500; }
.font-semibold { font-weight: 600; }
.font-bold { font-weight: 700; }
.font-extrabold { font-weight: 800; }
.italic { font-style: italic; }
.uppercase { text-transform: uppercase; }
.text-sm { font-size: 0.875rem; line-height: 1.25rem; }
.text-2xl { font-size: 1.5rem; line-height: 2rem; }
.text-\\[11px\\] { font-size: 11px; }
.text-\\[13px\\] { font-size: 13px; }
.text-\\[14px\\] { font-size: 14px; }
.tracking-\\[1px\\] { letter-spacing: 1px; }
.tracking-\\[2px\\] { letter-spacing: 2px; }
.text-left { text-align: left; }
.text-center { text-align: center; }
.text-right { text-align: right; }
`;
