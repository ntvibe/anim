(() => {
  const STORAGE_KEYS = [
    'anim-studio:experiment-01:v6',
    'anim-studio:experiment-01:v5',
  ];
  const RETRY_KEY = 'anim-studio:boot-retry:v1';
  const BACKUP_KEY = 'anim-studio:recovery-backup:v1';
  let runtimeError = null;
  let enhancementsLoaded = false;

  try {
    const backup = {};
    for (const key of STORAGE_KEYS) {
      const value = localStorage.getItem(key);
      if (value != null) backup[key] = value;
    }
    if (Object.keys(backup).length) sessionStorage.setItem(BACKUP_KEY, JSON.stringify(backup));
  } catch {}

  window.addEventListener('error', (event) => {
    runtimeError = event.error || event.message || 'Unknown runtime error';
  });
  window.addEventListener('unhandledrejection', (event) => {
    runtimeError = event.reason || 'Unhandled promise rejection';
  });

  function editorLooksBooted() {
    const rows = document.querySelectorAll('#layerTree .layer-row');
    const name = document.getElementById('layerName');
    const canvas = document.getElementById('stage');
    return rows.length > 0 && !!name && name.value.trim().length > 0 && !!canvas && canvas.width > 0 && canvas.height > 0;
  }

  function loadEnhancements() {
    if (enhancementsLoaded) return;
    enhancementsLoaded = true;

    for (const href of ['./enhancements.css?v=6.3.0', './mobile-timeline.css?v=6.4.0']) {
      const css = document.createElement('link');
      css.rel = 'stylesheet';
      css.href = href;
      document.head.appendChild(css);
    }

    for (const src of ['./enhancements.js?v=6.3.0', './mobile-timeline.js?v=6.4.0']) {
      const script = document.createElement('script');
      script.type = 'module';
      script.src = src;
      document.body.appendChild(script);
    }
  }

  function showRecoveryMessage() {
    const host = document.querySelector('.stage-shell') || document.body;
    if (document.getElementById('bootRecovery')) return;
    const panel = document.createElement('div');
    panel.id = 'bootRecovery';
    panel.style.cssText = 'position:absolute;z-index:30;left:50%;top:50%;transform:translate(-50%,-50%);max-width:420px;padding:18px 20px;border:1px solid rgba(120,140,170,.22);border-radius:16px;background:rgba(255,255,255,.94);box-shadow:0 18px 50px rgba(50,70,100,.16);font:13px/1.45 -apple-system,BlinkMacSystemFont,Segoe UI,sans-serif;color:#263244;text-align:center';
    panel.innerHTML = '<strong style="display:block;margin-bottom:6px;font-size:14px">Animation Studio could not finish loading.</strong><span style="display:block;color:#728096;margin-bottom:12px">Your previous local state was backed up for this browser session.</span><button type="button" style="border:0;border-radius:10px;padding:9px 13px;background:#2f78ff;color:white;font-weight:650;cursor:pointer">Reset local project and reload</button>';
    panel.querySelector('button').addEventListener('click', () => {
      try { STORAGE_KEYS.forEach((key) => localStorage.removeItem(key)); sessionStorage.removeItem(RETRY_KEY); } catch {}
      location.reload();
    });
    if (getComputedStyle(host).position === 'static') host.style.position = 'relative';
    host.appendChild(panel);
  }

  window.setTimeout(() => {
    if (editorLooksBooted()) {
      try { sessionStorage.removeItem(RETRY_KEY); } catch {}
      loadEnhancements();
      return;
    }

    let retry = 0;
    try { retry = Number(sessionStorage.getItem(RETRY_KEY) || 0); } catch {}

    // First recovery pass: discard only the newest potentially-corrupt save.
    if (retry === 0) {
      try {
        sessionStorage.setItem(RETRY_KEY, '1');
        localStorage.removeItem(STORAGE_KEYS[0]);
      } catch {}
      location.reload();
      return;
    }

    // Second pass: fall back to a completely clean project.
    if (retry === 1) {
      try {
        sessionStorage.setItem(RETRY_KEY, '2');
        STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
      } catch {}
      location.reload();
      return;
    }

    console.error('Animation Studio failed to boot after recovery attempts.', runtimeError);
    showRecoveryMessage();
  }, 900);
})();
