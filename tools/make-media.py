"""Builds docs/media from real project output.

- par-chart.png: solver-optimal steps vs par vs shipped solution per level,
  parsed from `node scripts/level-report.mjs` (run by this script).
- pip-plays.gif: frames captured by tools/capture-media.sh.
- stills: cropped/optimised copies of the headless-Firefox screenshots.
Run: .venv/bin/python tools/make-media.py   (after tools/capture-media.sh)
"""
import glob, os, re, subprocess
import matplotlib
matplotlib.use("Agg")
import matplotlib.pyplot as plt
from PIL import Image

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
TMP, OUT = os.path.join(ROOT, ".tmp/media"), os.path.join(ROOT, "docs/media")
os.makedirs(OUT, exist_ok=True)

# --- chart from the real level report ---
rep = subprocess.run(["node", "scripts/level-report.mjs"], cwd=ROOT, capture_output=True,
                     text=True, timeout=300, check=True).stdout
rows, world = [], None
for line in rep.splitlines():
    m = re.match(r"^\d+\s+(w\d-\d)\s+.+?\s{2,}(\S+)\s+(\d+)\s+(\d+)\s+(\d+)\s+(\d+)", line)
    if m:
        lid, opt, ps, psz, ss, ssz = m.groups()
        rows.append((lid, None if opt in ("-", "?", "—") else int(opt), int(ps), int(psz), int(ss), int(ssz)))
print(f"parsed {len(rows)} levels from level-report")

fig, (a1, a2) = plt.subplots(2, 1, figsize=(11, 6.2), sharex=True)
x = range(len(rows))
labels = [r[0][1:] for r in rows]
a1.bar([i - 0.2 for i in x], [r[2] for r in rows], 0.4, label="par steps", color="#f5b041")
a1.bar([i + 0.2 for i in x], [r[4] for r in rows], 0.4, label="shipped solution steps", color="#5dade2")
a1.plot([i for i, r in enumerate(rows) if r[1] is not None], [r[1] for r in rows if r[1] is not None],
        "k.", label="BFS solver optimum")
a1.set_ylabel("steps (floor 1)")
a1.legend(frameon=False, fontsize=9)
a1.set_title("Every level, measured: solver optimum vs par vs shipped solution")
a2.bar(x, [r[5] for r in rows], 0.6, color="#58d68d", label="solution size (instructions)")
a2.set_ylabel("program size")
a2.legend(frameon=False, fontsize=9)
for ax in (a1, a2):
    for b in range(8, len(rows), 8):
        ax.axvline(b - 0.5, color="#bbb", lw=0.8)
    ax.spines[["top", "right"]].set_visible(False)
a2.set_xticks(list(x), labels, rotation=90, fontsize=8)
a2.set_xlabel("level (world-number)")
fig.tight_layout()
fig.savefig(os.path.join(OUT, "par-chart.png"), dpi=90)

# --- stills ---
def still(name, box=None, width=900):
    p = os.path.join(TMP, name + ".png")
    if not os.path.exists(p):
        print("missing", p); return
    im = Image.open(p).convert("RGB")
    if box: im = im.crop(box)
    im = im.resize((width, round(im.height * width / im.width)), Image.LANCZOS)
    im.quantize(colors=128, method=Image.MEDIANCUT).save(os.path.join(OUT, name + ".png"), optimize=True)

for n in ["map", "debug", "blocks", "crew", "hint", "floors", "lab"]:
    still(n)

# --- GIF ---
frames = sorted(glob.glob(os.path.join(TMP, "frames", "f*.png")))
if frames:
    imgs = []
    for f in frames:
        im = Image.open(f).convert("RGB")
        im = im.resize((640, round(im.height * 640 / im.width)), Image.LANCZOS)
        imgs.append(im.quantize(colors=96, method=Image.MEDIANCUT))
    durs = [700] + [260] * (len(imgs) - 2) + [1800]
    imgs[0].save(os.path.join(OUT, "pip-plays.gif"), save_all=True, append_images=imgs[1:],
                 duration=durs, loop=0, optimize=True)
    print("gif frames", len(imgs), "seconds", sum(durs) / 1000)
