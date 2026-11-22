const paths: Record<string, React.ReactNode> = {
  sidebar: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9 4v16"/></>,
  codex: <><path d="M8 7 4 12l4 5m8-10 4 5-4 5m-2-13-4 16"/></>,
  plus: <path d="M12 5v14M5 12h14" />,
  play: <path d="m8 5 11 7-11 7Z" />,
  film: <><rect x="3" y="4" width="18" height="16" rx="3"/><path d="M7 4v16M17 4v16M3 9h4M3 15h4M17 9h4M17 15h4"/></>,
  sliders: <><path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="3"/><circle cx="15" cy="17" r="3"/></>,
  settings: <><path d="m10 3-1 3-3 1-3 3 2 3-1 3 3 2 3-1 3 2 3-1 1-3 3-2-1-3 1-3-3-2-3 1Z"/><circle cx="12" cy="12" r="3"/></>,
  link: <><path d="m10 13 4-4m-6 6-2 2a4 4 0 0 1-5-5l5-5a4 4 0 0 1 6 1m0 8a4 4 0 0 0 6 1l5-5a4 4 0 0 0-5-5l-2 2" transform="translate(1 0) scale(.9)"/></>,
  upload: <><path d="M12 16V3m-5 5 5-5 5 5M4 16v4h16v-4"/></>,
  folder: <path d="M3 7V5h7l2 3h9v12H3Z"/>,
  check: <path d="m5 12 4 4 10-10"/>,
  close: <path d="m6 6 12 12M18 6 6 18"/>,
  download: <><path d="M12 3v12m-5-5 5 5 5-5M4 17v4h16v-4"/></>,
  clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
  search: <><circle cx="10" cy="10" r="6"/><path d="m15 15 5 5"/></>,
  spark: <><path d="m12 3 2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5ZM20 2v4m-2-2h4"/></>,
  text: <><path d="M4 5h16M12 5v15M8 20h8"/></>,
  crop: <><path d="M6 3v15h15M3 6h15v15"/></>,
  sound: <><path d="M4 9h4l5-4v14l-5-4H4ZM17 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14"/></>,
  undo: <><path d="m8 4-5 5 5 5M3 9h10a6 6 0 0 1 0 12h-3"/></>,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2"/><path d="M15 8V3H3v13h5"/></>,
  send: <><path d="m3 3 19 9L3 21l4-9Zm4 9h15"/></>,
  stop: <rect x="5" y="5" width="14" height="14" rx="2"/>,
};
export function Icon({ name, size = 18 }: { name: string; size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name] || paths.film}</svg>;
}
