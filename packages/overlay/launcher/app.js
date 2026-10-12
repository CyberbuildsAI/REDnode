// The REDnode launcher: lists installed apps and opens or closes them.
// Uses window.rednode.apps, which the host gives only to the launcher.
'use strict';

const $ = (id) => document.getElementById(id);
const panel = $('panel');

$('toggle').addEventListener('click', () => {
  panel.hidden = !panel.hidden;
  if (!panel.hidden) refresh();
});

function row(app) {
  const div = document.createElement('div');
  div.className = 'app';

  const text = document.createElement('div');
  const name = document.createElement('div');
  name.className = 'name';
  name.textContent = app.name;
  const meta = document.createElement('div');
  meta.className = 'meta';
  meta.textContent = [app.version && `v${app.version}`, app.author].filter(Boolean).join(' · ');
  text.append(name, meta);

  const toggle = document.createElement('rn-toggle');
  if (app.open) toggle.setAttribute('checked', '');
  toggle.addEventListener('change', async (e) => {
    try {
      await window.rednode.apps.setOpen(app.id, e.detail.checked);
    } catch (err) {
      toggle.checked = !e.detail.checked;
      RednodeUI.notify(String(err.message || err).replace(/^Error invoking remote method '[^']+': (Error: )?/, ''), {
        type: 'error',
        title: app.name,
      });
    }
  });

  div.append(text, toggle);
  if (app.description) {
    const desc = document.createElement('div');
    desc.className = 'desc';
    desc.textContent = app.description;
    div.append(desc);
  }
  return div;
}

// GPU sharing on or off. Switching reopens every window.
$('gpu').addEventListener('change', async (e) => {
  const path = await window.rednode.apps.renderPath(e.detail.checked ? 'gpu' : 'cpu');
  $('gpu').checked = path === 'gpu';
  RednodeUI.notify(path === 'gpu' ? 'GPU sharing on' : 'GPU sharing off: CPU path', { title: 'Render path' });
});

async function refresh() {
  $('gpu').checked = (await window.rednode.apps.renderPath()) === 'gpu';
  const apps = await window.rednode.apps.list();
  const list = $('apps');
  list.replaceChildren(...apps.map(row));
  if (!apps.length) list.innerHTML = '<p class="empty">No apps installed.</p>';
  $('count').textContent = `· ${apps.filter((a) => a.open).length}/${apps.length}`;
}

window.rednode.on((m) => {
  if (m.event === 'apps') refresh();
  if (m.event === 'link' || m.event === 'hello') {
    const on = m.event === 'hello' || m.connected;
    $('link').textContent = on ? 'LINKED' : 'OFF';
    $('link').className = on ? '' : 'off';
  }
});

window.rednode.state().then((s) => {
  $('link').textContent = s.connected ? 'LINKED' : 'OFF';
  $('link').className = s.connected ? '' : 'off';
});
refresh();
