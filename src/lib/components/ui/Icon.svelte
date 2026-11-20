<script lang="ts" module>  export type IconName =
    | 'home' | 'search' | 'heart' | 'heart-fill' | 'playlist' | 'settings' | 'play' | 'pause'
    | 'prev' | 'next' | 'shuffle' | 'repeat' | 'repeat-one' | 'volume' | 'volume-x' | 'minus'
    | 'maximize' | 'restore' | 'x' | 'queue' | 'lyrics' | 'chevron-down' | 'chevron-up' | 'chevron-left' | 'chevron-right' | 'sliders'
    | 'plus' | 'trash' | 'wave' | 'trending' | 'clock' | 'arrow-left' | 'logout' | 'eye-off'
    | 'external' | 'more';

  const P: Record<IconName, string> = {
    home: 'M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zM9 22V12h6v10',
    search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16zM21 21l-4.3-4.3',
    heart: 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.500-2A5.500 5.500 0 0 0 2 8.500c0 2.300 1.500 4.050 3 5.500l7 7z',
    'heart-fill': 'M19 14c1.5-1.5 3-3.2 3-5.5A5.5 5.5 0 0 0 16.5 3c-1.8 0-3 .5-4.5 2-1.5-1.5-2.7-2-4.500-2A5.500 5.500 0 0 0 2 8.500c0 2.300 1.500 4.050 3 5.500l7 7z',
    playlist: 'M21 15V6M18.5 18a2.500 2.500 0 1 0 0-5 2.500 2.500 0 0 0 0 5zM12 12H3M16 6H3M12 18H3',
    settings: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM19.400 15a1.650 1.650 0 0 0 .33 1.820l.06.06a2 2 0 1 1-2.830 2.830l-.06-.06a1.650 1.650 0 0 0-1.820-.33 1.650 1.650 0 0 0-1 1.510V21a2 2 0 1 1-4 0v-.09A1.650 1.650 0 0 0 9 19.400a1.650 1.650 0 0 0-1.820.33l-.06.06a2 2 0 1 1-2.830-2.830l.06-.06A1.650 1.650 0 0 0 4.680 15a1.650 1.650 0 0 0-1.510-1H3a2 2 0 1 1 0-4h.09A1.650 1.650 0 0 0 4.600 9a1.650 1.650 0 0 0-.33-1.820l-.06-.06a2 2 0 1 1 2.830-2.830l.06.06A1.650 1.650 0 0 0 9 4.680a1.650 1.650 0 0 0 1-1.510V3a2 2 0 1 1 4 0v.09a1.650 1.650 0 0 0 1 1.510 1.650 1.650 0 0 0 1.820-.33l.06-.06a2 2 0 1 1 2.830 2.830l-.06.06A1.650 1.650 0 0 0 19.400 9a1.650 1.650 0 0 0 1.510 1H21a2 2 0 1 1 0 4h-.09a1.650 1.650 0 0 0-1.510 1z',
    play: 'M7 4.8a1 1 0 0 1 1.5-.86l11.2 6.7a1 1 0 0 1 0 1.72l-11.2 6.7A1 1 0 0 1 7 18.2V4.8z',
    pause: 'M6.5 4.5h3.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H6.5a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1zm7.5 0h3.5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1H14a1 1 0 0 1-1-1v-13a1 1 0 0 1 1-1z',
    prev: 'M18.5 5.2v13.6a.8.8 0 0 1-1.3.63L8.7 12.63a.8.8 0 0 1 0-1.26l8.5-6.8a.8.8 0 0 1 1.3.63zM5.5 5v14',
    next: 'M5.5 5.2v13.6a.8.8 0 0 0 1.3.63l8.5-6.8a.8.8 0 0 0 0-1.26l-8.5-6.8a.8.8 0 0 0-1.3.63zM18.5 5v14',
    shuffle: 'M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
    repeat: 'M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3',
    'repeat-one': 'M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3M11 10h1v4',
    volume: 'M11 5L6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4V5zM15.5 8.5a5 5 0 0 1 0 7M18.8 5.2a9.5 9.5 0 0 1 0 13.6',
    'volume-x': 'M11 5L6 9H3a1 1 0 0 0-1 1v4a1 1 0 0 0 1 1h3l5 4V5zM22 9l-6 6M16 9l6 6',
    minus: 'M5 12h14',
    maximize: 'M5 5h14v14H5z',
    restore: 'M8 8V5h11v11h-3M5 8h11v11H5z',
    x: 'M18 6L6 18M6 6l12 12',
    queue: 'M3 6h18M3 12h18M3 18h12',
    lyrics: 'M4 6h16M4 12h10M4 18h14',
    'chevron-down': 'M6 9l6 6 6-6',
    'chevron-up': 'M18 15l-6-6-6 6',
    'chevron-left': 'M15 18l-6-6 6-6',
    'chevron-right': 'M9 6l6 6-6 6',
    sliders: 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6',
    plus: 'M5 12h14M12 5v14',
    trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2',
    wave: 'M2 10v3M6 6v11M10 3v18M14 8v7M18 5v13M22 10v3',
    trending: 'M22 7l-8.500 8.500-5-5L2 17M16 7h6v6',
    clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20zM12 6v6l4 2',
    'arrow-left': 'M19 12H5M12 19l-7-7 7-7',
    logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
    'eye-off': 'M9.900 4.240A9.100 9.100 0 0 1 12 4c7 0 10 8 10 8a13.200 13.200 0 0 1-1.670 2.680M6.610 6.610A13.500 13.500 0 0 0 2 12s3 8 10 8a9.700 9.700 0 0 0 5.390-1.610M2 2l20 20',
    external: 'M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3',
    more: 'M5 12a1.5 1.5 0 1 0 0 .01M12 12a1.5 1.5 0 1 0 0 .01M19 12a1.5 1.5 0 1 0 0 .01'
  };
  const FILLED = new Set<IconName>(['play', 'pause', 'heart-fill']);
</script>

<script lang="ts">  let { name, size = 16 }: { name: IconName; size?: number } = $props();
</script>

<svg
  class="icon shrink-0"
  width={size}
  height={size}
  viewBox="0 0 24 24"
  fill={FILLED.has(name) ? 'currentColor' : 'none'}
  stroke="currentColor"
  stroke-width={FILLED.has(name) ? '1.4' : '1.85'}
  stroke-linecap="round"
  stroke-linejoin="round"
  aria-hidden="true"
>
  <path d={P[name]} />
</svg>
