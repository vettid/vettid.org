// 4. Terms — upload a new version (PDF), publish drafts, download.

import { el, chip, mono, muted, time } from '../dom.js';

const MAX_BYTES = 10 * 1024 * 1024;
const LINK_TTL_MS = 4.5 * 60 * 1000; // download URLs live 5 min
const STATUS_TONE = { draft: 'warn', current: 'ok', superseded: 'mute' };

async function checkPdf(file) {
  if (!file) return 'Choose a PDF file.';
  if (file.type && file.type !== 'application/pdf') return `That file is ${file.type}, not a PDF.`;
  if (!/\.pdf$/i.test(file.name)) return 'The file must have a .pdf extension.';
  if (file.size > MAX_BYTES) return `The PDF is ${(file.size / 1048576).toFixed(1)} MB; the limit is 10 MB.`;
  if (file.size === 0) return 'The file is empty.';
  const magic = await file.slice(0, 5).text();
  if (magic !== '%PDF-') return 'That file does not look like a PDF (missing %PDF header).';
  return null;
}

function byAt(by, at) {
  if (!at) return muted('—');
  return el('div', {}, time(at), by ? el('div', { class: 'sub' }, by) : null);
}

export function render(root, { api, ui }) {
  const title = el('input', { type: 'text', name: 'title', required: true, maxlength: 200, autocomplete: 'off', placeholder: 'e.g. VettID Membership Terms, October 2026' });
  const file = el('input', { type: 'file', name: 'file', accept: 'application/pdf,.pdf', required: true });
  const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Upload draft');
  const progress = el('p', { class: 'muted', hidden: true }, 'Uploading…');
  const form = el('form', { class: 'card form-grid' },
    el('h3', {}, 'New version'),
    ui.field('Title', title),
    ui.field('PDF (max 10 MB)', file),
    el('div', { class: 'form-actions' }, submit, progress),
  );

  const list = ui.pagedList({
    columns: ['Title', 'Version', 'Status', 'SHA-256', 'Created', 'Published', 'Actions'],
    emptyText: 'No terms versions yet.',
    makePager: () => api.pager('/admin/terms'),
    row: (t, row) => {
      const id = api.seg(t.version_id);
      const download = ui.action('Get download link', async (btn) => {
        const { url } = await api.get(`/admin/terms/${id}/download-url`);
        if (new URL(url).protocol !== 'https:') throw new Error('Download URL was not https.');
        const link = el('a', { class: 'btn btn-sm', href: url, target: '_blank', rel: 'noopener noreferrer' }, 'Open PDF');
        btn.replaceWith(link);
        setTimeout(() => {
          if (link.isConnected) row.update(t);
        }, LINK_TTL_MS);
      });
      const publish = t.status === 'draft'
        ? ui.action('Publish', async () => {
            const ok = await ui.confirm({
              title: 'Publish terms',
              body: [
                `Publish "${t.title}" as the current terms?`,
                'The current version becomes superseded. Every member will have to accept this new version; the SHA-256 of the PDF is fixed at publish.',
              ],
              confirmLabel: 'Publish',
            });
            if (!ok) return;
            await api.post(`/admin/terms/${id}/publish`);
            ui.toast(`Published "${t.title}".`);
            list.reload(); // the previously current version changed too
          })
        : null;
      return [
        t.title,
        mono(t.version_id),
        chip(t.status, STATUS_TONE[t.status] ?? 'mute'),
        t.sha256 ? el('code', { class: 'mono', title: t.sha256 }, `${t.sha256.slice(0, 12)}…`) : muted('—'),
        byAt(t.created_by, t.created_at),
        byAt(t.published_by, t.published_at),
        ui.rowActions(publish, download),
      ];
    },
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    ui.busy(form, async () => {
      const pdf = file.files[0];
      const problem = await checkPdf(pdf);
      if (problem) throw new Error(problem);
      const { terms, upload_url: uploadUrl } = await api.post('/admin/terms', { title: title.value.trim() });
      list.prepend(terms);
      progress.hidden = false;
      try {
        await api.uploadPdf(uploadUrl, pdf);
      } catch (err) {
        throw new Error(`Draft "${terms.title}" was created, but the PDF upload failed: ${err.message} Do not publish it; create a new version instead.`);
      } finally {
        progress.hidden = true;
      }
      form.reset();
      ui.toast('Draft uploaded. Review it, then Publish.');
    });
  });

  root.append(
    ui.sectionHead('Terms', 'Members must accept the current version to become members. Drafts are not visible to members until published.'),
    form,
    list.node,
  );
  list.reload();
}
