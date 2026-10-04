// Hides Activepieces branding and menus the CRM does not use. Runs only on the "CRM skin" address.
(function () {
  var HIDE_TEXT = ['Explore', 'Impact', 'Leaderboard', 'Support', 'Add team project', 'Platform Admin'];
  var css = document.createElement('style');
  css.textContent =
    '[data-sidebar="header"]{display:none!important}' +              /* logo + "Activepieces" at the top of the menu */
    'img[alt*="logo" i],a[href="/"] > img{display:none!important}' +  /* logo in the flow builder */
    '.stint-hide{display:none!important}';
  document.documentElement.appendChild(css);
  document.title = 'Automations';
  function sweep() {
    document.querySelectorAll('[data-sidebar="menu-button"],button,a').forEach(function (el) {
      var t = (el.textContent || '').trim();
      if (HIDE_TEXT.indexOf(t) >= 0) { (el.closest('li,[data-sidebar="menu-item"]') || el).classList.add('stint-hide'); }
    });
    document.querySelectorAll('link[rel~="icon"]').forEach(function (l) { l.href = 'data:,'; });
    if (document.title !== 'Automations' && /activepieces/i.test(document.title)) document.title = document.title.replace(/activepieces/ig, 'Automations');
  }
  new MutationObserver(sweep).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', sweep);
})();
