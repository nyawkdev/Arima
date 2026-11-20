const I18N = {
  en: {
    navPreview: 'Preview',
    navFeatures: 'Features',
    navDownload: 'Download',
    badge: 'Windows 10/11 · Portable .exe',
    heroTitle: 'SoundCloud, distilled to pure OLED.',
    heroSub:
      'Fast, single-file portable desktop player with Dynamic Island overlay, real-time Slowed + Reverb & 5-band EQ, synced lyrics, and native Windows media integration.',
    ctaDownload: 'Download Portable (.exe)',
    ctaExplore: 'Explore features',
    shot1: 'Home & Themes',
    shot2: 'Now Playing',
    shot3: 'Audio & Settings',
    featuresTitle: 'Built for focus and sound',
    featuresSub: 'Zero clutter, instant startup, and deep customization without leaving pure black.',
    f1Title: 'Dynamic Island Overlay',
    f1Desc: 'Floating mini-player in Island, Pill, or Mini mode with automatic hiding in fullscreen games and apps.',
    f2Title: 'Real-Time Audio Engine',
    f2Desc: '5-band parametric EQ, preamp, Bass Boost, Slowed, Slowed + Reverb, Speed Up, and Nightcore.',
    f3Title: 'Synced Lyrics',
    f3Desc: 'Smooth word-by-word and line-by-line karaoke view with instrumental gap indicators.',
    f4Title: 'Windows SMTC & Discord',
    f4Desc: 'Native Windows media overlay with artwork plus Discord Rich Presence with cleaned track metadata.',
    f5Title: 'Adaptive OLED Themes',
    f5Desc: 'True #000000 background, curated color presets, custom theme editor, and dynamic cover-art accents.',
    f6Title: 'Portable Single Binary',
    f6Desc: 'No installer, no background bloat. Aggressive memory trimming keeps idle RAM usage minimal.',
    dlTitle: 'Ready to listen?',
    dlDesc: 'Download the latest portable Windows executable from GitHub Releases and run it directly.',
    dlBtn: 'Latest Release (Arima.exe)',
    dlMeta: 'Windows 10 / 11 (x64) · Portable',
    footerNote: 'Built with Tauri v2, SvelteKit & Rust.'
  },
  ru: {
    navPreview: 'Обзор',
    navFeatures: 'Возможности',
    navDownload: 'Скачать',
    badge: 'Windows 10/11 · Портативный .exe',
    heroTitle: 'SoundCloud в чистом OLED.',
    heroSub:
      'Быстрый портативный плеер в одном файле с оверлеем Dynamic Island, эффектами Slowed + Reverb и 5-полосным эквалайзером, синхронизированными текстами и интеграцией с Windows.',
    ctaDownload: 'Скачать портативную версию (.exe)',
    ctaExplore: 'Возможности',
    shot1: 'Главная и темы',
    shot2: 'Плеер и тексты',
    shot3: 'Звук и настройки',
    featuresTitle: 'Создан для звука и фокуса',
    featuresSub: 'Ничего лишнего, мгновенный запуск и глубокая настройка на базе чистого чёрного.',
    f1Title: 'Оверлей Dynamic Island',
    f1Desc: 'Плавающий мини-плеер в стиле Island, Пилюля или Мини с автоскрытием в полноэкранных играх.',
    f2Title: 'Аудиодвижок реального времени',
    f2Desc: '5-полосный эквалайзер, преамп, Bass Boost, Slowed, Slowed + Reverb, Speed Up и Nightcore.',
    f3Title: 'Синхронизированные тексты',
    f3Desc: 'Плавный пословный и построчный караоке-режим с индикаторами инструментальных проигрышей.',
    f4Title: 'Windows SMTC и Discord',
    f4Desc: 'Нативная передача обложки и трека в Windows Media и Discord Rich Presence с очисткой названий.',
    f5Title: 'Адаптивные OLED-темы',
    f5Desc: 'Настоящий фон #000000, готовые палитры, своя тема и цвета, подстраивающиеся под обложку.',
    f6Title: 'Портативный единый файл',
    f6Desc: 'Без установщика и лишнего мусора. Агрессивная оптимизация памяти снижает расход ОЗУ в фоне.',
    dlTitle: 'Готовы слушать?',
    dlDesc: 'Скачайте последний портативный .exe из GitHub Releases и запускайте без установки.',
    dlBtn: 'Последний релиз (Arima.exe)',
    dlMeta: 'Windows 10 / 11 (x64) · Portable',
    footerNote: 'Сделано на Tauri v2, SvelteKit и Rust.'
  }
};

function applyLang(lang) {
  const dict = I18N[lang] || I18N.en;
  document.documentElement.lang = lang;
  for (const el of document.querySelectorAll('[data-i18n]')) {
    const key = el.getAttribute('data-i18n');
    if (key && dict[key]) el.textContent = dict[key];
  }
  for (const btn of document.querySelectorAll('.lang-btn')) {
    btn.classList.toggle('is-active', btn.getAttribute('data-lang') === lang);
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
    const lang = btn.getAttribute('data-lang') || 'en';
    applyLang(lang);
  });
}

applyLang('en');

(async function resolveLatestRelease() {
  const host = location.hostname;
  if (!host.endsWith('.github.io')) return;
  const owner = host.split('.')[0];
  const repo = location.pathname.split('/').filter(Boolean)[0];
  if (!owner || !repo) return;

  const repoUrl = `https://github.com/${owner}/${repo}`;
  const navRepo = document.getElementById('nav-repo');
  if (navRepo) navRepo.href = repoUrl;

  const fallbackUrl = `${repoUrl}/releases/latest`;
  const dl1 = document.getElementById('download-btn');
  const dl2 = document.getElementById('download-btn-2');
  if (dl1) dl1.href = fallbackUrl;
  if (dl2) dl2.href = fallbackUrl;

  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/releases/latest`);
    if (!res.ok) return;
    const data = await res.json();
    const exe = (data.assets || []).find((a) => a.name && a.name.toLowerCase().endsWith('.exe'));
    const targetUrl = exe ? exe.browser_download_url : data.html_url || fallbackUrl;
    if (dl1) dl1.href = targetUrl;
    if (dl2) dl2.href = targetUrl;
    const badge = document.getElementById('release-badge');
    if (badge && data.tag_name) badge.textContent = `${data.tag_name} · Portable .exe`;
  } catch {
  }
})();
