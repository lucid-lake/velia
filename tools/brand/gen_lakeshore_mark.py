"""The Velia mark (Lakeshore is the code name; the public name is Velia, owner 2026-10-29): a sloop seen from abeam (jib, main with a soft roach, a hull), riding on one waterline; the name
"Lakeshore" in the Lucid Lake wordmark's construction (weight 30, round ends and joins, title case), so the two sit as a
family beside each other without sharing a shape. Nothing below the waterline: the loading screen's horizon line and
the water's own reflection do that work. Writes every file in brand/, a small square cut for under 24 px, and favicon.svg.

Run from the repo root:
  python3 -I tools/brand/gen_lakeshore_mark.py            # write the SVGs
  python3 -I tools/brand/gen_lakeshore_mark.py --check    # fail if one is stale
  python3 -I tools/brand/gen_lakeshore_mark.py --inline   # print the inline <svg> fragments index.html carries

One colour per file: plush #F6F1E7 on dark grounds, navy #1C2340 on light (the Lucid Lake README's colours).
"""
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "brand"
NAVY, PLUSH = "#1C2340", "#F6F1E7"
SW = 30

# "Lakeshore" in the Lucid Lake construction: (path, advance); x-height 80-200, the tall strokes from 36.
# L a k e are the Lucid Lake glyphs; s h o r are new, in the same geometry (r 60 bowls, r 36×30 for the s).
GLYPHS = {
    "L": ("M 15 36 V 200 H 95", 120),
    "a": ("M 75 80 A 60 60 0 1 0 75.1 80 M 135 80 V 200", 160),
    "k": ("M 15 36 V 200 M 105 86 L 22 156 M 52 132 L 112 200", 130),
    "e": ("M 17 140 H 133 A 60 60 0 1 0 116 184", 155),
    "s": ("M 82 95 A 36 30 0 1 0 51 140 A 36 30 0 1 1 20 185", 112),
    "h": ("M 15 36 V 200 M 15 140 A 60 60 0 0 1 135 140 V 200", 160),
    "o": ("M 75 80 A 60 60 0 1 0 75.1 80", 160),
    "r": ("M 15 80 V 200 M 15 140 A 60 60 0 0 1 114 94", 130),
    # Velia (the public name, owner 2026-10-29): V l i are new in the same geometry; e a are the Lucid Lake glyphs
    "V": ("M 15 36 L 79 200 L 143 36", 158),
    "l": ("M 15 36 V 200", 30),
    "i": ("M 15 80 V 200 M 15 40 V 40.5", 30),
}
NAME = "Velia"   # the player-facing name; "Lakeshore" stays the code name (and its files stay for the record)


def setword(text, ink, gap=26):
    x, out = 0, []
    for ch in text:
        d, adv = GLYPHS[ch]
        out.append(f'<path transform="translate({x} 0)" d="{d}" fill="none" stroke="{ink}" stroke-width="{SW}" stroke-linecap="round" stroke-linejoin="round"/>')
        x += adv + gap
    return "".join(out), x - gap


# The mark, in its own units. The waterline at y 132; the masthead at y 2. Bow to the left.
MAIN = "M 78 2 L 78 100 L 140 100 Q 124 54 78 2 Z"      # mast luff, foot, a leech with a soft roach
JIB = "M 70 22 L 8 100 L 58 100 Q 66 64 70 22 Z"           # forestay to the bow, a clew just forward of the mast
HULL = "M 0 108 H 140 L 134 124 H 24 Q 10 124 0 108 Z"      # a raked bow, a near-plumb transom
WATER = (-4, 130, 148, 5)                                   # x y w h, the waterline bar, like the Lucid Lake shoreline


def mark(ink, small, uid=""):
    """small: the cut for under 24 px (a heavier outline, the jib folded into the main, one thick water band)."""
    sw = 10 if small else 6
    if small:
        sails = f'<path d="M 66 4 L 66 100 L 140 100 Q 118 56 66 4 Z M 58 34 L 8 100 H 56 Z" fill="{ink}" stroke="{ink}" stroke-width="{sw}" stroke-linejoin="round"/>'
        hull = f'<path d="{HULL}" fill="{ink}" stroke="{ink}" stroke-width="{sw}" stroke-linejoin="round"/>'
        water = f'<rect x="-4" y="132" width="148" height="14" rx="7" fill="{ink}"/>'
        return sails + hull + water
    sails = (f'<path d="{MAIN}" fill="{ink}" stroke="{ink}" stroke-width="{sw}" stroke-linejoin="round"/>'
             f'<path d="{JIB}" fill="{ink}" stroke="{ink}" stroke-width="{sw}" stroke-linejoin="round"/>')
    hull = f'<path d="{HULL}" fill="{ink}" stroke="{ink}" stroke-width="{sw}" stroke-linejoin="round"/>'
    x, y, w, h = WATER
    water = f'<rect x="{x}" y="{y}" width="{w}" height="{h}" rx="{h / 2:g}" fill="{ink}"/>'
    return sails + hull + water


def svg(vb, w, h, body):
    x, y, vw, vh = vb
    return f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="{x} {y} {vw} {vh}" width="{w}" height="{h}">{body}</svg>\n'


def mark_file(ink):
    return svg((-10, -6, 160, 148), 160, 148, mark(ink, False))


def small_file(ink, ground=None):
    bg = f'<rect x="-12" y="0" width="160" height="160" rx="28" fill="{ground}"/>' if ground else ""
    return svg((-12, 0, 160, 160), 160, 160, bg + mark(ink, True).replace('y="132"', 'y="134"'))


def word_file(ink, word="Lakeshore"):
    body, w = setword(word, ink)
    return svg((-20, 0, w + 40, 250), w + 40, 250, body)


# The lockup: the mark's waterline on the word's baseline (y 200), the masthead near the cap line.
MARK_SCALE = 1.36                      # the masthead at y 22, above the cap line (36) as the Lucid Lake peak is; the waterline on the baseline
MARK_X, MARK_Y = 6, 200 - 132.5 * MARK_SCALE
WORD_X = 150 * MARK_SCALE + 50


def lockup_body(ink, word="Lakeshore"):
    body, w = setword(word, ink)
    return (f'<g transform="translate({MARK_X} {MARK_Y:.1f}) scale({MARK_SCALE})">{mark(ink, False)}</g>'
            f'<g transform="translate({WORD_X:.0f} 0)">{body}</g>'), WORD_X + w


def lockup_file(ink, word="Lakeshore"):
    body, w = lockup_body(ink, word)
    return svg((-20, 0, w + 40, 250), f"{w + 40:.0f}", 250, body)


FILES = {   # public name Velia (owner, 2026-10-29): no "Lakeshore" lockups or words are made any more

    "velia-mark-plush.svg": lambda: mark_file(PLUSH),
    "velia-mark-mono.svg": lambda: mark_file(NAVY),
    "velia-mark-small-mono.svg": lambda: small_file(NAVY),
    "velia-mark-small-reversed.svg": lambda: small_file(PLUSH, NAVY),
    "favicon.svg": lambda: small_file(PLUSH, "#0b1016"),   # the sloop alone: no name in it
    "velia-lockup-plush.svg": lambda: lockup_file(PLUSH, NAME),
    "velia-lockup-mono.svg": lambda: lockup_file(NAVY, NAME),
    "velia-word-plush.svg": lambda: word_file(PLUSH, NAME),
    "velia-word-mono.svg": lambda: word_file(NAVY, NAME),
}


def inline():
    """The fragments index.html inlines (no fetch before the first paint): the lockup without its own waterline (the
    page's horizon line is the water) and the Lucid Lake lockup is copied from brand/lucidlake/ as is."""
    body, w = lockup_body("currentColor", NAME)
    x, y, bw, h = WATER
    body = body.replace(f'<rect x="{x}" y="{y}" width="{bw}" height="{h}" rx="{h / 2:g}" fill="currentColor"/>', "")
    print(f'<svg viewBox="-20 0 {w + 40:.0f} 250" aria-label="{NAME}">{body}</svg>')


def main():
    check, want_inline = "--check" in sys.argv, "--inline" in sys.argv
    if want_inline:
        inline()
        return
    OUT.mkdir(parents=True, exist_ok=True)
    stale = []
    for name, fn in FILES.items():
        p, s = OUT / name, fn()
        if check:
            if not p.exists() or p.read_text() != s:
                stale.append(name)
        else:
            p.write_text(s)
    if check:
        if stale:
            print("stale: " + ", ".join(stale))
            sys.exit(1)
        print(f"{len(FILES)} brand files current")
    else:
        print(f"wrote {len(FILES)} files to {OUT}")


if __name__ == "__main__":
    main()
