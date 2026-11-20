const I18N = {
  en: {
    navPreview: 'Preview',
    navFeatures: 'Features',
    navDownload: 'Download',
    navGet: 'Download',
    kicker: 'Windows 10/11, x64 portable',
    heroTitle: 'SoundCloud client for Windows',
    heroSub:
      'Desktop player in a single portable .exe with Dynamic Island overlay, 5-band EQ, Slowed + Reverb, synced lyrics, and Windows media integration',
    ctaDownload: 'Download Arima.exe',
    ctaExplore: 'Features',
    specFormatLabel: 'Format',
    specOverlayLabel: 'Overlay hotkey',
    specAudioLabel: 'Audio',
    specAudioVal: '5-band EQ, Reverb',
    specSystemLabel: 'Integration',
    shot1: 'Home & Themes',
    shot2: 'Now Playing',
    shot3: 'Audio & Settings',
    shotCaption1: 'Home / Themes',
    shotCaption2: 'Now Playing / Lyrics',
    shotCaption3: 'Audio / Settings',
    featuresTitle: 'What is included',
    featuresSub: 'Built with Tauri v2, SvelteKit, and Rust',
    f1Title: 'Equalizer and playback modes',
    f1Desc: '5-band equalizer, preamp, Bass Boost, and built-in speed and reverb presets',
    f2Title: 'Dynamic Island overlay',
    f2Desc: 'Floating mini-player in Island, Pill, or Mini style with automatic hiding in fullscreen apps',
    f2Meta: 'Toggle',
    f3Title: 'Synced lyrics',
    f3Desc: 'Synced lyrics viewer with click-to-seek and source info',
    f4Title: 'Windows SMTC and Discord',
    f4Desc: 'Sends track title, artist, and cover art to Windows media controls and Discord Rich Presence',
    f5Title: 'Portable build and themes',
    f5Desc: 'Single Arima.exe file, local SQLite history, stream cache, proxy support, and custom themes',
    dlTitle: 'Download for Windows',
    dlDesc: 'Portable Arima.exe without an installer. Requires Windows 10/11 (x64) with WebView2',
    dlBtn: 'Download Arima.exe',
    dlMeta: 'Windows 10/11 (x64), WebView2',
    footerNote: 'Tauri v2 / SvelteKit / Rust'
  },
  ru: {
    navPreview: 'Обзор',
    navFeatures: 'Возможности',
    navDownload: 'Скачать',
    navGet: 'Скачать',
    kicker: 'Windows 10/11, x64 portable',
    heroTitle: 'SoundCloud-клиент для Windows',
    heroSub:
      'Десктопный плеер в одном файле .exe с оверлеем Dynamic Island, 5-полосным эквалайзером, Slowed + Reverb, текстами и интеграцией с Windows',
    ctaDownload: 'Скачать Arima.exe',
    ctaExplore: 'Возможности',
    specFormatLabel: 'Формат',
    specOverlayLabel: 'Клавиша оверлея',
    specAudioLabel: 'Звук',
    specAudioVal: '5-band EQ, Reverb',
    specSystemLabel: 'Интеграции',
    shot1: 'Главная и темы',
    shot2: 'Плеер и тексты',
    shot3: 'Звук и настройки',
    shotCaption1: 'Главная / Темы',
    shotCaption2: 'Плеер / Тексты',
    shotCaption3: 'Звук / Настройки',
    featuresTitle: 'Что внутри',
    featuresSub: 'Сделано на Tauri v2, SvelteKit и Rust',
    f1Title: 'Эквалайзер и режимы звука',
    f1Desc: '5-полосный эквалайзер, преамп, Bass Boost и режимы скорости и реверберации',
    f2Title: 'Оверлей Dynamic Island',
    f2Desc: 'Плавающий мини-плеер в стиле Island, Пилюля или Мини с автоскрытием в полноэкранных окнах',
    f2Meta: 'Скрыть',
    f3Title: 'Синхронизированные тексты',
    f3Desc: 'Просмотр текстов песен с перемоткой по клику и указанием источника',
    f4Title: 'Windows SMTC и Discord',
    f4Desc: 'Передача названия, автора и обложки в панель медиа Windows и Discord Rich Presence',
    f5Title: 'Портативный файл и темы',
    f5Desc: 'Один файл Arima.exe, локальная история SQLite, кэш, прокси и свои цветовые темы',
    dlTitle: 'Скачать для Windows',
    dlDesc: 'Портативный Arima.exe без установки. Требуется Windows 10/11 (x64) и WebView2',
    dlBtn: 'Скачать Arima.exe',
    dlMeta: 'Windows 10/11 (x64), WebView2',
    footerNote: 'Tauri v2 / SvelteKit / Rust'
  }
};

let activeLang = 'en';
let activeShot = '1';

function updateCaption() {
  const cap = document.getElementById('shot-caption');
  if (!cap) return;
  const key = `shotCaption${activeShot}`;
  cap.textContent = (I18N[activeLang] || I18N.en)[key] || '';
}

function applyLang(lang) {
  activeLang = lang === 'ru' ? 'ru' : 'en';
  const dict = I18N[activeLang];
  document.documentElement.lang = activeLang;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (key && dict[key]) el.textContent = dict[key];
  }
  for (const btn of document.querySelectorAll('.lang-btn')) {
    btn.classList.toggle('is-active', btn.getAttribute('data-lang') === activeLang);
  }
  updateCaption();
}

const shotImg = document.getElementById('shot-img');
for (const btn of document.querySelectorAll('.tab-btn')) {
  btn.addEventListener('click', () => {
    const id = btn.getAttribute('data-shot');
    if (!id || !shotImg) return;
    activeShot = id;
    shotImg.src = `./assets/screenshots/${id}.png`;
    for (const b of document.querySelectorAll('.tab-btn')) {
      const active = b === btn;
      b.classList.toggle('is-active', active);
      b.setAttribute('aria-selected', String(active));
    }
    updateCaption();
  });
}

for (const btn of document.querySelectorAll('.lang-btn')) {
  btn.addEventListener('click', () => {
    applyLang(btn.getAttribute('data-lang') || 'en');
  });
}

applyLang('en');

(async function resolveLatestRelease() {
  const owner = 'nyawkdev';
  const repo = 'Arima';
  const repoUrl = `https://github.com/${owner}/${repo}`;
  const fallbackUrl = `${repoUrl}/releases/latest`;

  const navRepo = document.getElementById('nav-repo');
  const dl1 = document.getElementById('download-btn');
  const dl2 = document.getElementById('download-btn-2');
  const dlNav = document.getElementById('nav-download');
  if (navRepo) navRepo.href = repoUrl;
  if (dl1) dl1.href = fallbackUrl;
  if (dl2) dl2.href = fallbackUrl;
  if (dlNav) dlNav.href = fallbackUrl;

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
    if (!res.ok) return;
    const data = await res.json();
    const exe = (data.assets || []).find((a) => a.name && a.name.toLowerCase().endsWith('.exe'));
    const targetUrl = exe ? exe.browser_download_url : data.html_url || fallbackUrl;
    if (dl1) dl1.href = targetUrl;
    if (dl2) dl2.href = targetUrl;
    if (dlNav) dlNav.href = targetUrl;
    const meta = document.getElementById('release-meta');
    if (meta && data.tag_name) meta.textContent = `${data.tag_name}, Windows 10/11 (x64)`;
  } catch {
  }
})();
