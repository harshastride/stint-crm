// Hides Activepieces branding and menus the CRM does not use. Runs only on the "CRM skin" address.
(function () {
  var HIDE_TEXT = ['Explore', 'Impact', 'Leaderboard', 'Support', 'Add team project', 'Platform Admin'];
  var css = document.createElement('style');
  css.textContent =
    '[data-sidebar="header"] > :not(.stint-brand){display:none!important}' +   /* Activepieces logo + name → Stint logo */
    '.stint-brand{display:flex;align-items:center;padding:6px 8px 2px}.stint-brand img{height:34px;width:auto}' +
    '.stint-hide{display:none!important}';
  document.documentElement.appendChild(css);
  document.title = 'Automations';
  // the slim icon bar inside a flow has no labels: recognise Explore (compass), Impact (chart), Leaderboard (trophy), Platform Admin (shield) by icon shape
  var ICONS = ['polygon[points^="16.24 7.76"]', 'path[d^="M3 3v16a2 2 0 0 0 2 2h16"]', 'path[d^="M10 14.66"]', 'path[d^="M20 13c0 5-3.5 7.5"]'];
  function sweep() {
    document.querySelectorAll('[data-sidebar="menu-button"]').forEach(function (el) {
      if (ICONS.some(function (q) { return el.querySelector(q); })) (el.closest('li,[data-sidebar="menu-item"]') || el).classList.add('stint-hide');
    });
    document.querySelectorAll('[data-sidebar="menu-button"],button,a').forEach(function (el) {
      var t = (el.textContent || '').trim();
      if (HIDE_TEXT.indexOf(t) >= 0) { (el.closest('li,[data-sidebar="menu-item"]') || el).classList.add('stint-hide'); }
    });
    document.querySelectorAll('[data-sidebar="header"]').forEach(function (h) {
      if (!h.querySelector('.stint-brand')) {
        var d = document.createElement('div'); d.className = 'stint-brand';
        d.innerHTML = '<img src="/__stint/logo.svg" alt="Stint">'; h.prepend(d);
      }
    });
    // logo in the flow builder's slim bar → Stint mark
    document.querySelectorAll('img[alt*="logo" i], a[href="/"] > img').forEach(function (i) {
      if (i.getAttribute('src') !== '/__stint/icon.svg') { i.setAttribute('src', '/__stint/icon.svg'); i.removeAttribute('srcset'); }
    });
    document.querySelectorAll('link[rel~="icon"]').forEach(function (l) { if (l.getAttribute('href') !== '/__stint/icon.svg') l.setAttribute('href', '/__stint/icon.svg'); });
    if (document.title !== 'Automations' && /activepieces/i.test(document.title)) document.title = document.title.replace(/activepieces/ig, 'Automations');
  }
  new MutationObserver(sweep).observe(document.documentElement, { childList: true, subtree: true });
  document.addEventListener('DOMContentLoaded', sweep);
})();
