// 4. Terms — write or load plain text; the API renders the PDF. Preview,
// publish or delete drafts; download any version.

import { el, chip, mono, muted, time } from '../dom.js';

const MAX_CHARS = 200_000;
const MAX_FILE_BYTES = 1024 * 1024;
const LINK_TTL_MS = 4.5 * 60 * 1000; // download URLs live 5 min
const STATUS_TONE = { draft: 'warn', current: 'ok', superseded: 'mute' };

function byAt(by, at) {
  if (!at) return muted('—');
  return el('div', {}, time(at), by ? el('div', { class: 'sub' }, by) : null);
}

export function render(root, { api, ui }) {
  const title = el('input', { type: 'text', name: 'title', required: true, maxlength: 200, autocomplete: 'off', placeholder: 'e.g. VettID Membership Terms, October 2026' });
  const text = el('textarea', { name: 'text', rows: 16, required: true, maxlength: MAX_CHARS, class: 'mono', placeholder: 'Paste the terms here. Separate paragraphs with a blank line.' });
  const count = el('span', { class: 'muted' }, '0 characters');
  const file = el('input', { type: 'file', accept: '.txt,.md,text/plain' });
  const submit = el('button', { type: 'submit', class: 'btn btn-primary' }, 'Create draft');
  const form = el('form', { class: 'card form-grid' },
    el('h3', {}, 'New version'),
    ui.field('Title', title),
    ui.field('Load from a text file (optional)', file),
    ui.field('Terms text', text),
    el('div', { class: 'form-actions' }, submit, count),
  );

  const updateCount = () => {
    count.textContent = `${text.value.length.toLocaleString()} characters`;
  };
  text.addEventListener('input', updateCount);

  // Reading happens locally; nothing is sent until "Create draft".
  file.addEventListener('change', async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      if (f.size > MAX_FILE_BYTES) throw new Error('That file is over 1 MB; terms text should be far smaller.');
      const content = await f.text();
      if (content.includes('\u0000')) throw new Error('That does not look like a text file.');
      text.value = content;
      if (!title.value.trim()) title.value = f.name.replace(/\.[^.]+$/, '').replace(/[-_]+/g, ' ');
      updateCount();
    } catch (err) {
      ui.showError(err.message);
    } finally {
      file.value = '';
    }
  });

  const list = ui.pagedList({
    columns: ['Title', 'Version', 'Status', 'Text SHA-256', 'Created', 'Published', 'Actions'],
    emptyText: 'No terms versions yet.',
    makePager: () => api.pager('/admin/terms'),
    row: (t, row) => {
      const id = api.seg(t.version_id);
      const download = ui.action(t.status === 'draft' ? 'Preview PDF' : 'Get PDF link', async (btn) => {
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
                'The current version becomes superseded, and every member will have to accept this one. Published terms cannot be edited or deleted.',
              ],
              confirmLabel: 'Publish',
            });
            if (!ok) return;
            await api.post(`/admin/terms/${id}/publish`);
            ui.toast(`Published "${t.title}".`);
            list.reload(); // the previously current version changed too
          })
        : null;
      const remove = t.status === 'draft'
        ? ui.action('Delete draft', async () => {
            const ok = await ui.confirm({ title: 'Delete draft', body: [`Delete the draft "${t.title}"?`], confirmLabel: 'Delete' });
            if (!ok) return;
            await api.del(`/admin/terms/${id}`);
            ui.toast('Draft deleted.');
            row.remove();
          })
        : null;
      return [
        t.title,
        mono(t.version_id),
        chip(t.status, STATUS_TONE[t.status] ?? 'mute'),
        t.sha256 ? el('code', { class: 'mono', title: t.sha256 }, `${t.sha256.slice(0, 12)}…`) : muted('—'),
        byAt(t.created_by, t.created_at),
        byAt(t.published_by, t.published_at),
        ui.rowActions(download, publish, remove),
      ];
    },
  });

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    ui.busy(form, async () => {
      if (!text.value.trim()) throw new Error('The terms text is empty.');
      const terms = await api.post('/admin/terms', { title: title.value.trim(), text: text.value });
      list.prepend(terms);
      form.reset();
      updateCount();
      ui.toast('Draft created. Preview the PDF, then Publish.');
    });
  });

  root.append(
    ui.sectionHead('Terms', 'Members must accept the current version to become members. The text is the official version (its SHA-256 is what members accept); the PDF is generated from it.'),
    form,
    list.node,
  );
  list.reload();
}
