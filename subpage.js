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
