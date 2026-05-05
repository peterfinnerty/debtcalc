// Restore back-button targets from sessionStorage on sub-pages.
// The Vercel CSP blocks inline onclick handlers, so we set the href here
// and let normal anchor navigation handle the click.
(function () {
  try {
    const url = sessionStorage.getItem('calcUrl');
    if (!url) return;
    document.querySelectorAll('.btn-back').forEach(a => { a.href = url; });
  } catch (_) {}
})();

// "simplifications" disclosure toggle on how-it-works.html
document.addEventListener('click', e => {
  const t = e.target.closest('[data-action="toggle-simp"]');
  if (!t) return;
  e.preventDefault();
  const list = t.closest('.other-card')?.querySelector('.simp-list');
  if (list) list.hidden = !list.hidden;
});
