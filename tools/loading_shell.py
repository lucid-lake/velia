"""The loading screen's first-paint shell: writes src/ui/loading-shell.html (the source: markup + CSS, with placeholders)
into index.html, demos/loading.html and v2/index.html (Velia v2's front door) between the lk-load markers, with the brand SVGs and the 48 px stills inlined.

  python3 -I tools/loading_shell.py            # write both pages
  python3 -I tools/loading_shell.py --check    # fail if either page is stale

Placeholders: __LL_MARK__ (brand/lucidlake/lucidlake-mark-plush.svg in currentColor: the byline's logo),
__LL_LOCKUP__ (brand/lucidlake/lucidlake-lockup-plush.svg: the studio card's fallback until G1 loads),
__VELIA_WORD__ (brand/velia-word-plush.svg, the hero wordmark; the page re-sets its stroke finer),
__AUTO__ (data-auto on index.html, nothing on the demo), __TOKENS__ (src/ui/tokens.css, the design tokens, inline so the
first paint has them), __CRUISE_MODES__ (the ?mode= values whose card is Cruise's:
the ids and aliases of src/modes/rows.js's rows with card 'cruise': the mode registry's pure half),
__V2_OUT_CSS__ (v2/index.html only: the card's way out on a mode tap, V2_OUT_CSS below; the line is dropped on v1's pages).
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "src/ui/loading-shell.html"
import json
_WI = json.loads((ROOT / "src/waters/index.json").read_text())
_VI = json.loads((ROOT / "src/vessels/index.json").read_text())
LAKE = json.loads((ROOT / "src/waters" / next(w["file"] for w in _WI["waters"] if w["id"] == _WI["default"])).read_text())   # the default lake's descriptor: place, coordinates, chart (src/waters/)
VESSEL = json.loads((ROOT / "src/vessels" / next(v["file"] for v in _VI["vessels"] if v["id"] == _VI["default"])).read_text())   # the default boat's plate (src/vessels/)
TAGLINE = LAKE["hero"]   # the hero line under the title: edit it in the lake descriptor (src/waters/) (also the og/meta description)
WHAT = LAKE["what"]   # the plain line under the hero line: what Velia is (a draft for the owner)
TITLE = LAKE["title"]   # <title> and og/twitter title
DESC = LAKE["description"]   # the page's meta description
SHARE_TITLE = "Velia"   # og / twitter title (the link preview shows the name)
SHARE_DESC = TAGLINE + " Free, no sign-up."   # og / twitter description: the hero line
BYLINE = "By Lucid Lake Studio."
COURSE = (tuple(LAKE["chart"]["course"]["from"]), tuple(LAKE["chart"]["course"]["to"]))   # the pencilled course in the map box
MPU = LAKE["chart"]["metresPerUnit"]


def dm(deg, pos, neg):
    """38.954 -> 38 deg 57 min N (degrees and whole minutes)"""
    a = abs(deg); d = int(a); m = round((a - d) * 60)
    if m == 60: d, m = d + 1, 0
    return f"{d}\u00b0{m:02d}\u2032 {pos if deg >= 0 else neg}"


def voyage_subs():
    """The voyage bar (src/ui/voyageBar.js, the one source): its CSS and its SVG, read from the module's two template strings."""
    js = (ROOT / "src/ui/voyageBar.js").read_text()
    css = re.search(r"export const VOYAGE_CSS = `(.*?)`;", js, re.S).group(1)
    svg = "".join(re.findall(r"`([^`]*)`", re.search(r"export const VOYAGE_SVG = (.*?);\n", js, re.S).group(1)))
    return {"__VOYAGE_CSS__": css, "__VOYAGE_SVG__": svg}


def boat_line(v):
    """The card's one summary line names the boat short: "Halcyon · 28 ft" (src/ui/home.js boatLine)."""
    m = re.match(r"([\d.]+)-ft", v["short"])
    return f'{v["name"]} \u00b7 {m.group(1)} ft' if m else v["name"]


def lake_subs():
    L, c = LAKE, LAKE["chart"]
    return {
        "__PLACE__": f'{L["place"]} \u00b7 {L["region"]}'.upper(),
        "__WATERS_V__": f'{L["place"]} \u00b7 {L["region"]}',
        "__VESSEL_V__": boat_line(VESSEL),
        "__WHAT__": WHAT,
        "__PLABEL_NAME__": f'{L["place"]} \u00b7 {L["region"]}',
        "__PLABEL_COORDS__": f'{dm(L["lat"], "N", "S")} {dm(L["lon"], "E", "W")}',
        "__BOX_W__": str(c["box"][0]), "__BOX_H__": str(c["box"][1]), "__ASPECT__": f'{c["box"][1] / c["box"][0]:.3f}',
        "__DEST_NAME__": c["destination"]["name"],
        # the name sits left of the waypoint (anchor end): a phone's card crops the chart's right side (2026-10-30)
        "__DEST_X__": str(c["destination"]["at"][0] - 12), "__DEST_Y__": str(c["destination"]["at"][1] + 4),
    }
PAGES = {ROOT / "index.html": "data-auto", ROOT / "demos/loading.html": "", ROOT / "v2/index.html": ""}   # v2: no data-auto (v2/ui/loading.js installs it: the same gate, no v1 boat prefetch)


def inline_svg(p):
    s = p.read_text().strip()
    return re.sub(r' (width|height)="[^"]*"', "", s.replace(' xmlns="http://www.w3.org/2000/svg"', ""), count=2)


def rose():
    """The compass rose: true north up, degree ticks every 5 degrees, a four-point star with the eight points half-shaded."""
    from math import sin, cos, radians
    pt = lambda a, r: (r * sin(radians(a)), -r * cos(radians(a)))
    f = lambda v: ("%.2f" % v).rstrip("0").rstrip(".")
    xy = lambda p_: f(p_[0]) + " " + f(p_[1])
    ticks = ""
    for a in range(0, 360, 5):
        r0 = 34 if a % 90 == 0 else 36 if a % 30 == 0 else 38 if a % 10 == 0 else 40
        ticks += "M" + xy(pt(a, r0)) + "L" + xy(pt(a, 44))
    star_l, star_r, star_o = "", "", ""
    for a, r, w in [(0, 32, 5.5), (90, 32, 5.5), (180, 32, 5.5), (270, 32, 5.5), (45, 20, 3.4), (135, 20, 3.4), (225, 20, 3.4), (315, 20, 3.4)]:
        tip, l, rr = pt(a, r), pt(a - 90, w), pt(a + 90, w)
        star_l += "M0 0L" + xy(l) + "L" + xy(tip) + "Z"     # the shaded half
        star_r += "M0 0L" + xy(rr) + "L" + xy(tip) + "Z"    # the open half
    return ('<svg class="lk-rose" viewBox="-52 -58 104 110" aria-hidden="true"><g transform="rotate(' + str(LAKE["chart"]["northDeg"]) + ')"><circle class="d" r="50"/>'
            '<g fill="none" stroke="var(--navy)" stroke-linejoin="round"><circle r="44" stroke-width="1.1"/><circle r="40.5" stroke-width=".6"/>'
            '<path d="' + ticks + '" stroke-width=".8"/><path d="' + star_r + '" stroke-width=".9"/></g>'
            '<path d="' + star_l + '" fill="var(--navy)"/><circle r="2" fill="var(--paper)" stroke="var(--navy)" stroke-width=".8"/>'
            '<path d="M0 -48.5L-2.6 -53.5H2.6Z" fill="var(--navy)"/><text x="0" y="-57" text-anchor="middle" font-size="9" font-weight="400" fill="var(--navy)" style="font-family:var(--lk-font);letter-spacing:0">N</text></g></svg>')


def course():
    from math import atan2, degrees, hypot
    (sx, sy), (ex, ey) = COURSE
    dx, dy = ex - sx, ey - sy
    brg = degrees(atan2(dx, -dy)) % 360
    metres = round(hypot(dx, dy) * MPU / 10) * 10   # the chart_bay.mjs scale: 2.4 m per unit
    return {"__COURSE_S__": f"{sx} {sy}", "__COURSE_E__": f"{ex} {ey}", "__COURSE_SX__": str(sx), "__COURSE_SY__": str(sy),
            "__COURSE_DX__": str(dx), "__COURSE_DY__": str(dy), "__COURSE_EX__": str(ex), "__COURSE_EY__": str(ey), "__COURSE_MX__": f"{(sx + ex) / 2:g}", "__COURSE_MY__": f"{(sy + ey) / 2:g}",
            "__COURSE_ANG__": f"{degrees(atan2(dy, dx)):.1f}", "__COURSE_NOTE__": f"{brg:03.0f}° T · {metres} m"}


def news_dates(path, name):
    block = (ROOT / path).read_text().split(f"export const {name} = [", 1)[1].split("\n];", 1)[0]
    return re.findall(r"date: '(\d{4}-\d{2}-\d{2})'", block)


def news_line(v2=False):
    """The card foot's ("Version 0.N", "6 November") (src/ui/news.js CARD_VERSION_LINE): N counts the release dates in NEWS.
    v2's page (v2/index.html) reads v2's list: NEWS_V2 (v2/ui/news.js) on top of v1's NEWS (V2_NEWS.cardLine)."""
    dates = (news_dates("v2/ui/news.js", "NEWS_V2") if v2 else []) + news_dates("src/ui/news.js", "NEWS")
    months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"]
    y, m, d = (int(x) for x in dates[0].split("-"))
    return f"Version 0.{len(set(dates))}", f"{d} {months[m - 1]}"


def support_subs(v2=False):
    """Support Velia on the card's foot: the link, the label, the line and the cup, from src/ui/support.js (one source)."""
    src = (ROOT / "src/ui/support.js").read_text()
    get = lambda k: re.search(k + r": '([^']*)'", src).group(1)
    return {"__SUP_URL__": get("url"), "__SUP_LABEL__": get("label"), "__SUP_LINE__": get("cardLine"),
            "__CUP__": re.search(r"export const CUP_ICON = '([^']*)'", src).group(1), "__CARD_VER__": news_line(v2)[0], "__CARD_DATE__": news_line(v2)[1]}


def mode_rows():
    """The mode registry's rows (its pure half, src/modes/rows.js, one row per line): [(id, [aliases], card)]."""
    src = (ROOT / "src/modes/rows.js").read_text()
    block = src.split("export const MODE_NAMES = [", 1)[1].split("\n];", 1)[0]
    rows = []
    for line in block.splitlines():
        m = re.search(r"\bid: '([\w-]+)'", line)
        if not m:
            continue
        aliases = re.findall(r"'([^']*)'", re.search(r"aliases: \[([^\]]*)\]", line).group(1))
        rows.append((m.group(1), aliases, re.search(r"card: '(\w+)'", line).group(1)))
    if not rows:
        sys.exit("src/modes/rows.js: no mode rows")
    cards = {c for _, _, c in rows}
    if not cards <= {"sail", "cruise"}:
        sys.exit(f"src/modes/rows.js: card(s) {sorted(cards - {'sail', 'cruise'})}: the first paint knows sail and cruise only (src/ui/loading-shell.html)")
    return rows


def mode_subs():
    return {"__CRUISE_MODES__": "|".join(n for i, a, c in mode_rows() if c == "cruise" for n in [i, *a])}


# v2 only (owner 2026-11-16: "the menu card flashes again, then it enters"): home -> out swapped lk-cardin for the base lk-sheet,
# which restarted at opacity 0 and rose back over the lake. A card on screen fades from full; a card that was away stays hidden
# (v2/ui/menuCard.js sets data-out-from=card); v2/tests/pages/homeEntry.page.mjs records it frame by frame.
V2_OUT_CSS = """    #lk-load[data-state=out] .lk-card{animation:none}   /* a mode tap on the first card: home → out used to swap lk-cardin for the base lk-sheet, which restarted at opacity 0 and rose back to 1 over the lake (the card flashed again; owner 2026-11-16). A card that was away (a tap while loading) stays away */
    #lk-load[data-state=out][data-out-from=card]:not([data-strip=on]) .lk-card{animation:lk-cardout .7s var(--lk-ease) both}   /* the card on screen fades away, from full, never back up (v2/ui/menuCard.js sets data-out-from) */
    @keyframes lk-cardout{from{opacity:var(--lk-out-op,1)}to{opacity:0}}   /* from what the last frame showed (menuCard.js --lk-out-op): a card still sliding in never jumps to full */"""


# v2 only (owner 2026-11-18, the desktop card top to bottom): VELIA; "By Lucid Lake Studio" (the old hero line is gone; "Free · no
# sign-up" left the card on 2026-11-24); the mini chart with the birthplace pins, larger, in the card's own gap (v2/ui/birthplaceCard.js mounts it into the sheet);
# the voyage line as the chart's caption; the mode row (the primary: one tall segmented pill, the lit cell filled); CHART LOG KEYS SETUP
# (secondary: quiet text); the foot. The sheet is a column the height of the card; the links and the foot stay at its bottom (--lh).
# Every rule is for a card that is not the phone's (:root[data-f-phone-card=on], v2/ui/phoneCard.js: untouched), a card showing its
# own face (no page open, not the fail state). Radii and hairlines are the round family's; gold only for lit.
_D = ":root:not([data-f-phone-card=on]) #lk-load:not([data-pg]):not([data-state=fail])"
V2_CARD_CSS = """    /* the desktop card, top to bottom (owner 2026-11-18) */
    __D__ .lk-sheet{position:absolute;inset:0;z-index:2;display:flex;flex-direction:column;box-sizing:border-box;max-width:none;padding:1.5em 1.9em calc(var(--lhd,7.6em) + .85em);pointer-events:none}
    __D__ .lk-sheet .lk-sum,__D__ .lk-sheet .lk-pick{pointer-events:auto}
    __D__ .lk-plan{display:contents}
    __D__ .lk-word{order:1;flex:none;font-size:2.7em}
    __D__ .lk-by{order:2;flex:none;margin:.75em 0 0;gap:.7em;white-space:nowrap}
    __D__ .lk-row.lk-sum{order:4;flex:none;align-self:stretch;width:auto;max-width:none;margin:.15em 0 0;padding:.5em .6em;justify-content:center;gap:0;border-radius:10px;font-size:max(1.08em,16px);color:var(--navy2)}
    __D__ .lk-row.lk-sum .v,__D__ .lk-row.lk-sum .dot,__D__ .lk-row.lk-sum .b{opacity:1;text-shadow:none}
    __D__ .lk-row.lk-sum .dot{opacity:.7}
    __D__ .lk-row.lk-sum .p{text-decoration:underline;text-decoration-color:rgb(var(--ink3) / .5);text-decoration-thickness:1px;text-underline-offset:.26em}
    __D__ .lk-row.lk-sum .ch{font-size:1.6em;margin-left:.3em;opacity:1;align-self:center;line-height:.7}
    __D__ .lk-row.lk-sum:hover,__D__ .lk-row.lk-sum:focus-visible{background:rgb(var(--ink3) / .14)}
    __D__ .lk-row.lk-sum:focus-visible{outline:2px solid var(--navy);outline-offset:1px}
    __D__ .lk-row.plan{order:5;flex:none;margin-top:.5em}
    __D__ .lk-status,__D__ .lk-fail{order:9}
    /* the art: the compass rose kept, smaller, in the header's corner; the chart below it is the real one */
    :root:not([data-f-phone-card=on]):not([data-card=parchment]) #lk-load:not([data-pg]) .lk-card > .lk-art-n{transform-origin:100% 0;transform:scale(.5);-webkit-mask-image:radial-gradient(circle at 80% 19%,#000 0 38%,transparent 72%);mask-image:radial-gradient(circle at 80% 19%,#000 0 38%,transparent 72%)}
    /* the mode row, the primary: one segmented control, tall cells, the lit cell filled (cream, navy text) */
    __D__ .lk-row .v.picks{border:1px solid rgb(var(--ink3) / .72);border-radius:999px;background:rgb(var(--pan) / .97)}
    __D__ .lk-card .lk-pick{height:46px;min-height:46px;font-size:max(1.08em,16px);letter-spacing:.06em}
    __D__ .lk-card .lk-pick + .lk-sep + .lk-pick{border-left:1px solid rgb(var(--ink3) / .38)}
    __D__ .lk-card .lk-pick[aria-checked=true]{background:var(--navy);color:var(--paper);border-color:var(--navy);font-weight:var(--lk-medium);text-shadow:none}
    __D__ .lk-card .lk-pick:hover:not([aria-checked=true]):not([disabled]){background:rgb(var(--ink3) / .12)}
    __D__ .lk-card .lk-pick:focus-visible{outline:2px solid var(--navy);outline-offset:-5px}
    __D__ .lk-card .lk-pick[aria-checked=true]:focus-visible{outline:0}
    /* the extras, secondary: CHART LOG KEYS SETUP as quiet tracked text between hairline ticks, no pills */
    __D__ .lk-links{gap:0}
    __D__ .lk-card .lk-link{position:relative;border:0;border-radius:8px;background:none;font-size:max(.96em,15px);letter-spacing:.16em;opacity:.84}
    __D__ .lk-card .lk-link + .lk-link{border-left:0;padding-left:.62em}
    __D__ .lk-card .lk-link + .lk-link::before{content:'';position:absolute;left:0;top:28%;bottom:28%;width:1px;background:rgb(var(--ink3) / .34)}
    __D__ .lk-card .lk-link:hover,__D__ .lk-card .lk-link:focus-visible{opacity:1;background:rgb(var(--ink3) / .1);border:0}
    __D__ .lk-card .lk-link:focus-visible{outline:2px solid var(--navy);outline-offset:-2px}
    /* the foot, one row (owner 2026-11-18): Support Velia left (a thin gold outline pill, 28 px, no fill, a 14 px cup; gold only here), "v0.7 · About ›"
       grouped right, nothing between; no coffee line and no date */
    __D__ .lk-foot{display:flex;align-items:center;justify-content:space-between;margin:.25em -.4em 0;padding:.35em .5em .05em;background:none}
    __D__ .lk-supl,__D__ .lk-ver .lk-date{display:none}
    __D__ .lk-sup{grid-area:auto;height:28px;min-height:28px;padding:0 .8em 0 .55em;gap:.4em;font-size:max(.96em,15px);letter-spacing:.03em;background:none;border:1px solid var(--brass)}
    __D__ .lk-sup .lk-cup{width:14px;height:14px}
    __D__ .lk-sup:hover,__D__ .lk-sup:focus-visible{background:color-mix(in srgb,var(--brass) 14%,transparent);border-color:color-mix(in srgb,var(--brass) 70%,#fff)}
    /* the right group "GitHub · v0.8 · About ›": the source link (the GitHub mark and its word, v2/ui/source.js) opens it; one dot between neighbours;
       28 px like its neighbours, a 44 px hit */
    __D__ .lk-foot .lk-gh{position:relative;order:0;margin:0 0 0 auto;height:28px;padding:0 .3em;font-size:max(.96em,15px);letter-spacing:.06em;opacity:.84}
    __D__ .lk-foot .lk-gh::after{content:'';position:absolute;inset:-8px 0}
    __D__ .lk-ver{order:1;grid-area:auto;display:flex;align-items:center;height:28px;margin:0;padding:0;font-size:0;opacity:.62;line-height:1}
    __D__ .lk-ver::after{content:attr(data-short);font-size:13px;letter-spacing:.04em}
    __D__ .lk-ver::before,__D__ .lk-card .lk-news::before{content:'\\00b7';font-size:16px;line-height:1;opacity:.75;margin:0 .45em}
    __D__ .lk-card .lk-news{order:2;grid-area:auto;justify-self:auto;display:flex;flex-direction:row;align-items:center;height:28px;min-height:28px;margin:0;padding:0 .3em 0 0;opacity:.84}
    __D__ .lk-card .lk-news .t{font-size:max(.96em,15px);letter-spacing:.06em}""".replace("__D__", _D)


# v2 only: the source link in the card's foot (v2/ui/source.js), where v1 has the language chip (v2 has no chip). Its base look is the
# foot's: the cream ink, the UI face, a faint wash on hover, a 2 px focus ring; the layouts place it (the desktop card above, the panel in
# v2/ui/chart/panelPlan.js, the phone's ⋯ list in v2/ui/phoneCard.js; the touch grid before the panel mounts: its third line).
V2_GH_CSS = """    /* the source link (v2/ui/source.js): the GitHub mark and its word, in the foot beside Support Velia */
    .lk-gh{all:unset;box-sizing:border-box;cursor:pointer;display:inline-flex;align-items:center;gap:.45em;color:var(--navy);font-family:var(--lk-ui,var(--lk-font));font-size:max(.84em,13px);letter-spacing:.04em;white-space:nowrap;border-radius:.25em;transition:background-color .2s,opacity .2s}
    .lk-gh .lk-ghm{display:block;flex:none;width:1em;height:1em;fill:currentColor}
    .lk-gh:hover,.lk-gh:focus-visible{background:rgb(var(--ink3) / .14);opacity:1}
    .lk-gh:focus-visible{outline:2px solid var(--navy);outline-offset:2px}
    #lk-load[data-pg] .lk-gh{display:none}
    @media (pointer:coarse){.lk-gh{min-height:44px}}
    #lk-load .lk-foot .lk-gh{grid-row:3;grid-column:1 / -1;justify-self:start;padding:0 .35em}"""


def source_link():
    """The card's source link (v2 only): v2/ui/source.js's address, label, word and mark."""
    src = (ROOT / "v2/ui/source.js").read_text()
    get = lambda k: re.search(k + r": '([^']*)'", src).group(1)
    mark = re.search(r"export const GH_MARK = '([^']*)'", src).group(1)
    return (f'<a class="lk-gh" href="{get("url")}" target="_blank" rel="noopener" aria-label="{get("label")}">'
            f'<svg class="lk-ghm" viewBox="0 0 24 24" aria-hidden="true">{mark}</svg><span>{get("word")}</span></a>')


V2_NIGHT_NOTE = """    /* night (owner, 2026-11-19: "I'm not a big fan of this colour; the default navy and white is enough"): the DOM keeps the day's navy
       and cream at every hour, so no page, sheet, menu or bar turns red. Only the in-world instruments keep the real-boat night red:
       the 3D cockpit's dials and plates (src/boat/nightLight.js, read from data-lk-theme by the station) and the autopilot keys' own
       rules (v2/ui/autopilot.js). src/ui/theme.js still sets data-lk-theme=night on <html> for those. */
"""


def v2_navy_tokens(tokens):
    """v2's copy of src/ui/tokens.css: the night token block (red cream, amber, navy, glass) is replaced by a note; v1 keeps it."""
    a = tokens.index("    /* night: real captains turn the instruments red")
    b = tokens.index("    /* the glass plates:", a)
    out = tokens[:a] + V2_NIGHT_NOTE + tokens[b:]
    return out.replace("After sunset the whole set shifts to a night-red palette (src/ui/theme.js sets data-lk-theme on <html>).",
                       "At night the DOM keeps the same navy and cream (owner, 2026-11-19); only the 3D instruments go red (src/ui/theme.js sets data-lk-theme on <html>).")


def render(auto, v2=False):
    head, body = SRC.read_text().split("<!-- ==== body ==== -->\n")
    sub = {
        "__LL_LOCKUP__": inline_svg(ROOT / "brand/lucidlake/lucidlake-lockup-plush.svg"),
        "__LL_MARK__": inline_svg(ROOT / "brand/lucidlake/lucidlake-mark-plush.svg").replace("#F6F1E7", "currentColor").replace("<svg ", '<svg class="lk-mk" aria-hidden="true" ', 1).replace('id="mp"', 'id="lk-mp"').replace("#mp", "#lk-mp"),
        "__VELIA_WORD__": inline_svg(ROOT / "brand/velia-word-plush.svg").replace("<svg ", '<svg aria-hidden="true" ', 1),
        "__AUTO__": auto,
        "__ROSE__": rose(),
        "__TAGLINE__": TAGLINE,
        "__CHART_BAY__": "\n".join("        " + l for l in (ROOT / "brand/chart-bay.svg").read_text().strip().split("\n")[1:]),
        **course(),
        **lake_subs(),
        **support_subs(v2),
        **mode_subs(),
        **voyage_subs(),
        "__TOKENS__": "\n".join("    " + l if l else l for l in (ROOT / "src/ui/tokens.css").read_text().rstrip("\n").split("\n")),
    }
    if v2:   # v2 only (owner 2026-11-17): the row reads CHART LOG KEYS SETUP; the foot's right link is About, not What's new (it stays in the Help nav and About)
        # owner 2026-11-18: Log reads Logbook (a voyage logbook, not a programmer's log); the desktop panel's row is SETUP · KEYS · TUTORIAL · LOGBOOK
        # (CHART and TUTORIAL are hidden by CSS where they do not belong: v2/ui/menuCard.js, v2/ui/chart/panelPlan.js)
        body = body.replace('<button class="lk-link" type="button" data-go="logbook">Log</button>', '<button class="lk-link" type="button" data-go="chart">Chart</button><button class="lk-link" type="button" data-go="logbook">Logbook</button>', 1)
        body = body.replace('<button class="lk-link" type="button" data-go="settings">Setup</button>', '<button class="lk-link" type="button" data-go="settings">Setup</button><button class="lk-link lk-tut" type="button" data-go="tutorials">Tutorial</button>', 1)
        body = body.replace('<button class="lk-link" type="button" data-go="about">About</button>', "", 1)
        body = re.sub(r'<button class="lk-news" type="button" data-go="news" data-from="home" aria-label="[^"]*"><span class="t">What’s new ', '<button class="lk-news" type="button" data-go="about" data-from="home" aria-label="About"><span class="t">About ', body, count=1)
    if v2:   # v2 only (owner 2026-11-18): no hero line on the card (owner 2026-11-24: no "Free · no sign-up" on it either)
        body = body.replace('        <p class="lk-sub">__TAGLINE__ <span class="lk-free">__WHAT__</span></p>\n', "", 1)
        body = body.replace('<p class="lk-by">__LL_MARK__<span>by Lucid Lake Studio</span></p>', '<p class="lk-hero"><span class="hs1">{_H1}</span><svg class="hw" viewBox="0 0 150 9" preserveAspectRatio="none" aria-hidden="true"><path d="M0 5 C8 0 16 0 24 4.5 S40 9 48 4.5 S64 0 72 4.5 S88 9 96 4.5 S112 0 120 4.5 S136 8 146 3.5 c3 -1.5 5 0 3 2"/></svg><span class="hs2">{_H2}</span></p>\n        <p class="lk-by">__LL_MARK__<span>by Lucid Lake Studio</span></p>', 1)   # owner 2026-11-19 (header A; owner 2026-11-19: the old slogan, the descriptor's tagline, replaces "Sail a real lake in your browser." on the panel): the panel shows VELIA and the hero line; the studio line stays in the markup (About reads its mark) and is hidden on the panel (v2/ui/chart/panelPlan.js). "Free · no sign-up" left the card (owner, 2026-11-24); the meta description and the share tags keep it
        _t = TAGLINE.split(". ", 1); body = body.replace("{_H1}", _t[0] + ("." if len(_t) > 1 else "")).replace("{_H2}", _t[1] if len(_t) > 1 else "")   # the slogan's two sentences: a script line and a small-caps line (owner 2026-11-19, pick A)
        body = re.sub(r'      <div class="lk-lang" inert>\n.*?\n      </div>\n', "", body, count=1, flags=re.S)   # no language chip on v2's card: the source link takes its place in the foot
        body = body.replace('</small></div>\n        <small class="lk-ver">', '</small></div>\n        ' + source_link() + '\n        <small class="lk-ver">', 1)
        body = re.sub(r'<small class="lk-ver">(.*?)</small>', r'<button class="lk-ver" type="button" data-go="news" data-from="home">\1</button>', body, count=1, flags=re.S)   # owner 2026-11-19: the version is a button too (it opens What's new); birthplaceCard.js names it "What's new in v0.7"
    if v2:   # v2 only (owner 2026-11-19: "the default navy and white is enough"): pages and menus stay navy and cream at night; v1's tokens.css and shell keep the night red
        sub["__TOKENS__"] = v2_navy_tokens(sub["__TOKENS__"])
        head = re.sub(r"    /\* night \(src/ui/theme\.js\): the lit parchment[^\n]*\n    :root\[data-lk-theme=night\] #lk-load\[data-state=menu\]:not\(\[data-pg\]\) \.lk-card\{filter:[^\n]*\n", "", head, count=1)   # the card's night sepia
    head = head.replace("__V2_OUT_CSS__\n", V2_OUT_CSS + "\n" + V2_CARD_CSS + "\n" + V2_GH_CSS + "\n" if v2 else "")
    if v2:   # the language chip's rules (the shared shell's) leave v2's page with the chip
        head = "\n".join(l for l in head.split("\n") if "lk-lang" not in l and "/* the language (owner" not in l and "/* the language: text only" not in l)   # a whole line: v1's pages keep no blank line
    for k, v in sub.items():
        head, body = head.replace(k, v), body.replace(k, v)
    return head.rstrip("\n"), body.rstrip("\n").replace(" >\n", ">\n")


def splice(text, head, body):
    text = re.sub(r"  <!-- lk-load:head .*?<!-- lk-load:head:end -->", lambda m: head, text, count=1, flags=re.S)
    desc = DESC
    text = re.sub(r"<title>[^<]*</title>", lambda m: f"<title>{TITLE}</title>", text, count=1)
    text = re.sub(r'(<meta (?:property="og:title"|name="twitter:title") content=")[^"]*(")', lambda m: m.group(1) + SHARE_TITLE + m.group(2), text)
    text = re.sub(r'(<meta name="description" content=")[^"]*(")', lambda m: m.group(1) + desc + m.group(2), text)
    text = re.sub(r'(<meta (?:property="og:description"|name="twitter:description") content=")[^"]*(")', lambda m: m.group(1) + SHARE_DESC + m.group(2), text)
    return re.sub(r"  <!-- lk-load:body -->.*?<!-- lk-load:body:end -->", lambda m: body, text, count=1, flags=re.S)


def main():
    check = "--check" in sys.argv
    stale = []
    for page, auto in PAGES.items():
        head, body = render(auto, v2=page == ROOT / "v2/index.html")
        old = page.read_text()
        if "lk-load:head" not in old or "lk-load:body" not in old:
            sys.exit(f"{page}: no lk-load markers")
        new = splice(old, head, body)
        if new != old:
            if check:
                stale.append(str(page.relative_to(ROOT)))   # v2/index.html, not a second "index.html"
            else:
                page.write_text(new)
    if check and stale:
        sys.exit("stale: " + ", ".join(stale))
    print("loading shell current" if check else "loading shell written")


if __name__ == "__main__":
    main()
