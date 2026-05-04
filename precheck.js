// Runs before the calculator paints. If the URL hash contains a saved plan
// (p= parameter), mark the document so CSS can skip the empty-state intro
// animation and show the results panel immediately. The class is removed by
// app.js once the initial reveal is complete so future state changes can animate.
(function () {
  if (/(?:^|&)p=/.test(location.hash.slice(1))) {
    document.documentElement.classList.add('has-data');
  }
})();
