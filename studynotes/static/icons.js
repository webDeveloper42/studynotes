"use strict";
// Plain line icons drawn for these mockups. No product's logos or artwork.
const ICON_PATHS = {
  box: "M4 8l8-4 8 4v9l-8 4-8-4zM4 8l8 4 8-4M12 12v9", coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM15 9c-.6-1.2-1.7-1.7-3-1.7-1.8 0-3 .9-3 2.3 0 3.2 6 1.6 6 4.8 0 1.4-1.2 2.3-3 2.3-1.4 0-2.5-.6-3-1.7M12 6v12",
  card: "M7 3h10v18H7zM12 8l2.5 4-2.5 4-2.5-4z", terminal: "M4 5h16v14H4zM8 10l3 2-3 2M13 14h3", lock: "M7 11V8a5 5 0 0 1 10 0v3M5 11h14v10H5z", plus: "M12 5v14M5 12h14", search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM21 21l-5-5",
  inbox: "M4 13l2.5-8h11L20 13v6H4zM4 13h5l1 3h4l1-3h5", today: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4",
  upcoming: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4M9 14h6", filter: "M4 6h16M7 12h10M10 18h4",
  check: "M5 12l5 5 9-10", chevron: "M9 6l6 6-6 6", down: "M6 9l6 6 6-6", left: "M15 6l-6 6 6 6", right: "M9 6l6 6-6 6",
  flag: "M6 21V4h11l-2 4 2 4H6", clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2", bolt: "M13 3L5 14h6l-1 7 8-11h-6z",
  home: "M4 11l8-7 8 7v9h-5v-6H9v6H4z", star: "M12 4l2.5 5.2 5.7.8-4.1 4 1 5.7-5.1-2.7-5.1 2.7 1-5.7-4.1-4 5.7-.8z",
  note: "M6 3h9l4 4v14H6zM15 3v4h4M9 12h7M9 16h7", task: "M5 12l4 4 10-10M5 5h6M5 19h14", file: "M7 3h7l4 4v14H7zM14 3v4h4",
  calendar: "M5 5h14v15H5zM5 10h14M9 3v4M15 3v4", book: "M5 4h12a2 2 0 0 1 2 2v14H7a2 2 0 0 1-2-2zM5 16h14", tag: "M4 4h8l8 8-8 8-8-8zM8.5 8.5h.01",
  people: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20c0-4 3-6 6-6s6 2 6 6M16 5a3 3 0 0 1 0 6M18 14c2 1 3 3 3 6", trash: "M5 7h14M10 7V4h4v3M7 7l1 13h8l1-13",
  dots: "M6 12h.01M12 12h.01M18 12h.01", bell: "M6 17V11a6 6 0 0 1 12 0v6l2 2H4zM10 21h4", list: "M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01",
  board: "M4 4h6v16H4zM14 4h6v10h-6z", wallet: "M4 7h15v13H4zM4 7l12-3v3M15 13h4", chart: "M5 20V10M12 20V4M19 20v-7", link: "M10 14a4 4 0 0 0 6 0l3-3a4 4 0 0 0-6-6l-1 1M14 10a4 4 0 0 0-6 0l-3 3a4 4 0 0 0 6 6l1-1",
  bold: "M7 4h6a4 4 0 0 1 0 8H7zM7 12h7a4 4 0 0 1 0 8H7z", italic: "M14 4h-4M14 20h-4M14 4l-4 16", underline: "M7 4v7a5 5 0 0 0 10 0V4M5 21h14", grid: "M4 4h7v7H4zM13 4h7v7h-7zM4 13h7v7H4zM13 13h7v7h-7z",
  share: "M18 8a3 3 0 1 0-3-3M6 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM18 22a3 3 0 1 0-3-3M8.6 10.6l6.8-4M8.6 13.4l6.8 4", sidebar: "M4 5h16v14H4zM9 5v14", note2: "M4 6h16M4 12h10M4 18h13",
  rocket: "M12 3c4 2 6 6 6 10l-3 3H9l-3-3c0-4 2-8 6-10zM12 10h.01M8 18l-2 3M16 18l2 3", gear: "M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M18.4 5.6l-2.1 2.1M7.7 16.3l-2.1 2.1",
  download: "M12 4v11M7 10l5 5 5-5M5 20h14", cloud: "M7 18a4 4 0 0 1-.6-7.96A6 6 0 0 1 17.8 8.6 4.7 4.7 0 0 1 17.5 18z", music: "M9 18V5l11-2v13M9 18a3 3 0 1 1-6 0 3 3 0 0 1 6 0zM20 16a3 3 0 1 1-6 0 3 3 0 0 1 6 0z", film: "M4 5h16v14H4zM8 5v14M16 5v14M4 9h4M4 15h4M16 9h4M16 15h4", retry: "M4 12a8 8 0 1 0 2.3-5.7M4 4v4h4", x: "M6 6l12 12M18 6L6 18",
  wave: "M2 12h2M6 8v8M10 5v14M14 8v8M18 10v4M22 12h-2", play: "M8 5l11 7-11 7z", stop: "M7 7h10v10H7z", up: "M6 15l6-6 6 6",
};
function icon(name, size = 18) {
  return `<svg class="ic" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>`;
}
