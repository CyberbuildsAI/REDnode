// Game API search. Loads search-index.json on first use and ranks matches:
// exact name, then prefix, then substring. Arrow keys move, Enter opens.
(() => {
  const KIND = { c: 'cls', n: 'nat', s: 'str', e: 'enm', b: 'bit', f: 'fn' };
  const esc = (s) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const root = document.body.dataset.root || '';
  let index = null;
  let loading = null;

  function load() {
    loading ??= fetch(root + 'search-index.json')
      .then((r) => r.json())
      .then((rows) => {
        index = rows.map((r) => ({ name: r[0], alt: r[1], kind: r[2], url: r[3], lc: r[0].toLowerCase(), lcAlt: r[1].toLowerCase() }));
      });
    return loading;
  }

  function rank(q) {
    const hits = [];
    for (const it of index) {
      let score = -1;
      if (it.lc === q || it.lcAlt === q) score = 0;
      else if (it.lc.startsWith(q) || it.lcAlt.startsWith(q)) score = 1;
      else if (it.lc.includes(q) || it.lcAlt.includes(q)) score = 2;
      if (score >= 0) hits.push([score, it.name.length, it]);
    }
    hits.sort((a, b) => a[0] - b[0] || a[1] - b[1] || a[2].name.localeCompare(b[2].name));
    return hits.slice(0, 60).map((h) => h[2]);
  }

  function setup(box) {
    const input = box.querySelector('input');
    const list = box.querySelector('.ga-results');
    let active = -1;

    const select = (i) => {
      const links = list.querySelectorAll('a');
      links.forEach((a, n) => a.setAttribute('aria-selected', n === i ? 'true' : 'false'));
      active = i;
      links[i]?.scrollIntoView({ block: 'nearest' });
    };

    const render = () => {
      const q = input.value.trim().toLowerCase();
      if (!q || !index) {
        list.hidden = true;
        return;
      }
      const results = rank(q);
      list.innerHTML = results.length
        ? results
            .map((r) => `<li><a href="${root}${r.url}"><span class="k">${KIND[r.kind]}</span><span>${esc(r.name)}</span>${r.alt ? `<span class="alt">${esc(r.alt)}</span>` : ''}</a></li>`)
            .join('')
        : '<li class="none">No matches</li>';
      list.hidden = false;
      select(results.length ? 0 : -1);
    };

    input.addEventListener('focus', () => load().then(render));
    input.addEventListener('input', () => load().then(render));
    input.addEventListener('keydown', (e) => {
      const count = list.querySelectorAll('a').length;
      if (e.key === 'ArrowDown' && count) {
        e.preventDefault();
        select((active + 1) % count);
      } else if (e.key === 'ArrowUp' && count) {
        e.preventDefault();
        select((active - 1 + count) % count);
      } else if (e.key === 'Enter' && active >= 0) {
        e.preventDefault();
        list.querySelectorAll('a')[active].click();
      } else if (e.key === 'Escape') {
        list.hidden = true;
        input.blur();
      }
    });
    document.addEventListener('click', (e) => {
      if (!box.contains(e.target)) list.hidden = true;
    });
    // "/" focuses search from anywhere on the page.
    document.addEventListener('keydown', (e) => {
      if (e.key === '/' && document.activeElement !== input && !/input|textarea/i.test(document.activeElement?.tagName)) {
        e.preventDefault();
        input.focus();
      }
    });
  }

  document.querySelectorAll('.ga-search').forEach(setup);
})();
