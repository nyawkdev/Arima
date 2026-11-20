const I18N = {
  en: {
    navPreview: 'Preview',
    navFeatures: 'Features',
    navDownload: 'Download',
    heroTitle: 'SoundCloud client for Windows',
    heroSub:
      'Desktop player in a single portable .exe with Dynamic Island overlay, 5-band EQ, Slowed + Reverb, synced lyrics, and custom themes',
    ctaDownload: 'Download Arima.exe',
    ctaExplore: 'Preview',
    shot1: 'Home & Themes',
    shot2: 'Now Playing',
    shot3: 'Audio & Settings',
    featuresTitle: 'Features',
    f1Title: 'Equalizer and playback modes',
    f1Desc: '5-band equalizer, preamp, Bass Boost, and Slowed, Slowed + Reverb, Speed Up, and Nightcore modes',
    f2Title: 'Dynamic Island overlay',
    f2Desc: 'Floating mini-player in Island, Pill, or Mini style with automatic hiding in fullscreen apps and Ctrl+Alt+I hotkey',
    f3Title: 'Synced lyrics',
    f3Desc: 'Synced lyrics viewer with click-to-seek and source info',
    f4Title: 'Windows SMTC and Discord',
    f4Desc: 'Sends track title, artist, and cover art to Windows media controls and Discord Rich Presence',
    f5Title: 'Themes and personalization',
    f5Desc: 'Dark, light, and system modes with preset palettes, custom accent colors, and cover-based theming',
    f6Title: 'Portable and self-contained',
    f6Desc: 'Single Arima.exe binary with local SQLite history, stream cache, and proxy support',
    dlTitle: 'Download for Windows',
    dlDesc: 'Portable Arima.exe without an installer. Requires Windows 10/11 (x64) with WebView2',
    dlBtn: 'Download Arima.exe'
  },
  ru: {
    navPreview: 'Обзор',
    navFeatures: 'Возможности',
    navDownload: 'Скачать',
    heroTitle: 'SoundCloud-клиент для Windows',
    heroSub:
      'Десктопный плеер в одном файле .exe с оверлеем Dynamic Island, 5-полосным эквалайзером, Slowed + Reverb, текстами и темами',
    ctaDownload: 'Скачать Arima.exe',
    ctaExplore: 'Обзор',
    shot1: 'Главная и темы',
    shot2: 'Плеер и тексты',
    shot3: 'Звук и настройки',
    featuresTitle: 'Возможности',
    f1Title: 'Эквалайзер и режимы звука',
    f1Desc: '5-полосный эквалайзер, преамп, Bass Boost и режимы Slowed, Slowed + Reverb, Speed Up и Nightcore',
    f2Title: 'Оверлей Dynamic Island',
    f2Desc: 'Плавающий мини-плеер в стиле Island, Пилюля или Мини с автоскрытием в полноэкранных окнах и клавишей Ctrl+Alt+I',
    f3Title: 'Синхронизированные тексты',
    f3Desc: 'Просмотр текстов песен с перемоткой по клику и указанием источника',
    f4Title: 'Windows SMTC и Discord',
    f4Desc: 'Передача названия, автора и обложки в панель медиа Windows и Discord Rich Presence',
    f5Title: 'Темы и оформление',
    f5Desc: 'Тёмный, светлый и системный режимы, палитры, свои цвета и тема под обложку трека',
    f6Title: 'Портативный файл',
    f6Desc: 'Один файл Arima.exe с локальной историей SQLite, кэшем потоков и поддержкой прокси',
    dlTitle: 'Скачать для Windows',
    dlDesc: 'Портативный Arima.exe без установки. Требуется Windows 10/11 (x64) и WebView2',
    dlBtn: 'Скачать Arima.exe'
  }
};

function applyLang(lang) {
  const activeLang = lang === 'ru' ? 'ru' : 'en';
  const dict = I18N[activeLang];
  document.documentElement.lang = activeLang;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (key && dict[key]) el.textContent = dict[key];
  }
  for (const btn of document.querySelectorAll('.lang-btn')) {
    btn.classList.toggle('is-active', btn.getAttribute('data-lang') === activeLang);
  }
}

const shotImg = document.getElementById('shot-img');
for (const btn of document.querySelectorAll('.tab-btn')) {
  btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-shot');
    if (!id || !shotImg) return;
    shotImg.src = `./assets/screenshots/${id}.png`;
    for (const b of document.querySelectorAll('.tab-btn')) {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
    }
  });
}

for (const btn of document.querySelectorAll('.lang-btn')) {
  btn.addEventListener('click', () => {
    applyLang(btn.getAttribute('data-lang') || 'en');
  });
}

applyLang('en');

(async function resolveLatestRelease() {
  const repoUrl = 'https://github.com/nyawkdev/Arima';
  const fallbackUrl = `${repoUrl}/releases/latest`;

  const navRepo = document.getElementById('nav-repo');
  const footerRepo = document.getElementById('footer-repo');
  const dl1 = document.getElementById('download-btn');
  const dl2 = document.getElementById('download-btn-2');
  if (navRepo) navRepo.href = repoUrl;
  if (footerRepo) footerRepo.href = repoUrl;
  if (dl1) dl1.href = fallbackUrl;
  if (dl2) dl2.href = fallbackUrl;

  try {
    const res = await fetch('https://api.github.com/repos/nyawkdev/Arima/releases/latest');
    if (!res.ok) return;
    const data = await res.json();
    const exe = (data.assets || []).find((a) => a.name && a.name.toLowerCase().endsWith('.exe'));
    const targetUrl = exe ? exe.browser_download_url : data.html_url || fallbackUrl;
    if (dl1) dl1.href = targetUrl;
    if (dl2) dl2.href = targetUrl;
  } catch {
  }
})();
