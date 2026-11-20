import { derived } from 'svelte/store';
import { settings } from '$lib/stores/settings';

export type Lang = 'en' | 'ru';

export const DICT = {
  en: {
    appName: 'Arima',
    nav: {
      home: 'Home',
      search: 'Search',
      library: 'Library',
      settings: 'Settings'
    },
    home: {
      wave: 'My Wave',
      waveSubtitle: 'Adaptive stream tailored to your taste and reactions',
      waveStart: 'Play',
      waveByTrack: 'By track',
      forYou: 'For you',
      mixes: 'Playlists for you',
      charts: 'Charts',
      history: 'History',
      recent12: '12 recent',
      openAll: 'All'
    },
    library: { likes: 'Likes', playlists: 'Playlists', history: 'History' },
    settings: {
      language: 'Language',
      languageDesc: 'Interface language',
      theme: 'Theme',
      themeDesc: 'Dark, light, or match system',
      themeDark: 'Dark',
      themeLight: 'Light',
      themeSystem: 'System',
      color: 'Color',
      colorDesc: 'Preset palettes, cover accent, or custom theme',
      autostart: 'Launch at startup',
      autostartDesc: 'Start Arima automatically when Windows boots',
      closeToTray: 'Minimize to tray on close',
      closeToTrayDesc: 'Keep music playing in the background',
      startMinimized: 'Start minimized',
      startMinimizedDesc: 'Do not open the main window on startup',
      discord: 'Discord integration',
      discordDesc: 'Show the current track in your Discord status',
      hideDupes: 'Hide duplicates',
      hideDupesDesc: 'Filter re-uploads with matching normalized titles',
      hideRemixes: 'Hide remixes',
      hideRemixesDesc: 'Keep only original tracks (no remix, slowed, hoodtrap, etc.)',
      tabProfile: 'Account',
      tabGeneral: 'General',
      tabAbout: 'About',
      subMain: 'General',
      subAudio: 'Audio',
      subTheme: 'Appearance',
      subIsland: 'Overlay',
      subHotkeys: 'Hotkeys',
      subCache: 'Cache & Network'
    },
    onboarding: {
      step1Title: 'Language & Appearance',
      step1Desc: 'Choose your preferred language and visual style',
      langLabel: 'Interface language',
      themeLabel: 'Theme',
      paletteLabel: 'Accent palette',
      step2Title: 'SoundCloud Account',
      step2Desc: 'Paste your SoundCloud OAuth token to sync likes, playlists, and recommendations (optional)',
      tokenPlaceholder: 'Paste oauth_token here',
      connectBtn: 'Connect',
      connectingBtn: 'Connecting...',
      connectedAs: 'Connected as',
      skipHint: 'You can skip this step and sign in later in Settings.',
      step3Title: 'Take a look at this',
      step3Desc: 'Pick the extra features you want enabled right out of the box',
      featIslandTitle: 'Dynamic Island Overlay',
      featIslandDesc: 'Compact floating mini-player on top of other windows',
      featAnimTitle: 'Window particle animations',
      featAnimDesc: 'Smooth particle burst when opening or minimizing Arima',
      featDiscordTitle: 'Discord Rich Presence',
      featDiscordDesc: 'Display your currently playing track in your Discord profile',
      back: 'Back',
      next: 'Next',
      start: 'Start listening'
    },
    common: {
      loading: 'Loading',
      empty: 'Empty',
      retry: 'Retry',
      more: 'More',
      play: 'Play',
      shuffle: 'Shuffle',
      tracks: 'tracks',
      cancel: 'Cancel',
      save: 'Save',
      create: 'Create'
    }
  },
  ru: {
    appName: 'Arima',
    nav: {
      home: 'Главная',
      search: 'Поиск',
      library: 'Медиатека',
      settings: 'Настройки'
    },
    home: {
      wave: 'Моя волна',
      waveSubtitle: 'Адаптивный поток по вашему вкусу и реакциям',
      waveStart: 'Включить',
      waveByTrack: 'По треку',
      forYou: 'Для вас',
      mixes: 'Плейлисты для вас',
      charts: 'Чарты',
      history: 'История',
      recent12: '12 недавних',
      openAll: 'Все'
    },
    library: { likes: 'Лайки', playlists: 'Плейлисты', history: 'История' },
    settings: {
      language: 'Язык',
      languageDesc: 'Язык интерфейса приложения',
      theme: 'Тема',
      themeDesc: 'Тёмный, светлый или как в системе',
      themeDark: 'Тёмная',
      themeLight: 'Светлая',
      themeSystem: 'Системная',
      color: 'Цвет',
      colorDesc: 'Готовые палитры, цвета обложки или своя тема',
      autostart: 'Автозапуск',
      autostartDesc: 'Запускать приложение при включении системы',
      closeToTray: 'Сворачивать в трей вместо закрытия',
      closeToTrayDesc: 'Приложение останется работать в фоне',
      startMinimized: 'Запускать свёрнутым',
      startMinimizedDesc: 'Не открывать главное окно при старте',
      discord: 'Интеграция с Discord',
      discordDesc: 'Показывать текущий трек в статусе Discord',
      hideDupes: 'Скрывать повторы',
      hideDupesDesc: 'Убирать дубликаты и перезаливы по нормализованному названию',
      hideRemixes: 'Скрывать ремиксы',
      hideRemixesDesc: 'Оставлять только оригинальные треки (без remix, slowed, hoodtrap и т.д.)',
      tabProfile: 'Аккаунт',
      tabGeneral: 'Общие',
      tabAbout: 'О программе',
      subMain: 'Основное',
      subAudio: 'Звук',
      subTheme: 'Оформление',
      subIsland: 'Оверлей',
      subHotkeys: 'Клавиши',
      subCache: 'Кэш и сеть'
    },
    onboarding: {
      step1Title: 'Язык и оформление',
      step1Desc: 'Выберите удобный язык и тему оформления',
      langLabel: 'Язык интерфейса',
      themeLabel: 'Тема',
      paletteLabel: 'Цветовая палитра',
      step2Title: 'Вход в SoundCloud',
      step2Desc: 'Вставьте OAuth-токен SoundCloud для синхронизации лайков, плейлистов и рекомендаций (необязательно)',
      tokenPlaceholder: 'Вставьте oauth_token',
      connectBtn: 'Подключить',
      connectingBtn: 'Подключение...',
      connectedAs: 'Подключено как',
      skipHint: 'Этот шаг можно пропустить и войти позже в настройках.',
      step3Title: 'Взгляните на это',
      step3Desc: 'Отметьте возможности, которые хотите включить сразу',
      featIslandTitle: 'Оверлей Dynamic Island',
      featIslandDesc: 'Компактный плавающий мини-плеер поверх других окон',
      featAnimTitle: 'Анимация окна частицами',
      featAnimDesc: 'Плавный распад и сборка окна частицами при открытии и сворачивании',
      featDiscordTitle: 'Интеграция с Discord',
      featDiscordDesc: 'Показывать текущий трек в статусе вашего профиля Discord',
      back: 'Назад',
      next: 'Далее',
      start: 'Начать слушать'
    },
    common: {
      loading: 'Загрузка',
      empty: 'Пусто',
      retry: 'Повторить',
      more: 'Ещё',
      play: 'Играть',
      shuffle: 'Вперемешку',
      tracks: 'треков',
      cancel: 'Отмена',
      save: 'Сохранить',
      create: 'Создать'
    }
  }
} as const;

export const lang = derived(settings, ($s): Lang => ($s.ui?.language === 'ru' ? 'ru' : 'en'));
export const tr = derived(lang, (l) => DICT[l]);
export const t = DICT.en;

export function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 10 || m100 >= 20)) return few;
  return many;
}
