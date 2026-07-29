// The splash banner — "ASCEND" in ANSI Shadow block art.
//
// This lives in TypeScript rather than in index.html on purpose: the art depends on runs of
// repeated spaces to hold its columns, and HTML formatters collapse those without warning (which
// is exactly how the previous copy lost the interiors of its C, E, N and D). A string array is
// inert to that kind of reformatting.
//
// Every row is BANNER_COLS wide, padded — a ragged right edge shifts the centring.

export const BANNER_COLS = 50;

export const BANNER: readonly string[] = [
  " █████╗ ███████╗ ██████╗███████╗███╗   ██╗██████╗ ",
  "██╔══██╗██╔════╝██╔════╝██╔════╝████╗  ██║██╔══██╗",
  "███████║███████╗██║     █████╗  ██╔██╗ ██║██║  ██║",
  "██╔══██║╚════██║██║     ██╔══╝  ██║╚██╗██║██║  ██║",
  "██║  ██║███████║╚██████╗███████╗██║ ╚████║██████╔╝",
  "╚═╝  ╚═╝╚══════╝ ╚═════╝╚══════╝╚═╝  ╚═══╝╚═════╝ ",
];

/** Below this many CSS pixels the block art can't hold its columns, so we fall back. */
const NARROW_PX = 340;

/** Spaced-out plain text for viewports too narrow for the block art. */
const BANNER_NARROW = "A S C E N D";

/**
 * Paint the banner into `#splash-banner`. The element is already `white-space: pre` and
 * `aria-label="ASCEND"`, so screen readers get the word and never the box-drawing characters.
 */
export function renderBanner(el: HTMLElement | null = document.getElementById("splash-banner")): void {
  if (!el) return;
  const paint = () => {
    const narrow = window.innerWidth < NARROW_PX;
    el.textContent = narrow ? BANNER_NARROW : BANNER.join("\n");
    el.classList.toggle("banner-narrow", narrow);
  };
  paint();
  window.addEventListener("resize", paint);
}
