"""Measure the supplied reference, keeping all values in image pixels and CSS pixels."""
import json
import shutil
from collections import Counter
from pathlib import Path
from PIL import Image

SOURCE = Path('/Users/mfordjody/.codex/attachments/74db3663-a074-4c16-9022-ed818cc25c02/image-1.png')
OUT = Path('.artifacts/conversation-reference')
OUT.mkdir(parents=True, exist_ok=True)
shutil.copyfile(SOURCE, OUT / 'reference.png')
im = Image.open(SOURCE).convert('RGB')
regions = {
    'background': (700, 550, 2350, 1550),
    'panel': (2390, 175, 2970, 510),
    'composer': (805, 1620, 2260, 1800),
    'bubble': (1510, 240, 2260, 423),
    'secondary': (2410, 190, 2530, 235),
    'tertiary': (2410, 252, 2710, 297),
    'work': (790, 532, 1075, 565),
    'link': (835, 875, 948, 911),
    'send': (2195, 1722, 2254, 1792),
}
palette = {}
for name, box in regions.items():
    counts = Counter(im.crop(box).get_flattened_data())
    # Text/controls need their most repeated foreground, excluding the sampled surface.
    exclude = {(31, 31, 36), (51, 51, 56), (60, 60, 64), (0, 0, 0), (255, 255, 255)}
    if name in ('background', 'panel', 'composer', 'bubble'):
        rgb = counts.most_common(1)[0][0]
    else:
        rgb = next(rgb for rgb, count in counts.most_common() if rgb not in exclude)
    palette[name] = '#' + ''.join(f'{channel:02x}' for channel in rgb)

def bounds(box, rgb):
    points = [(x, y) for y in range(box[1], box[3]) for x in range(box[0], box[2]) if im.getpixel((x, y)) == rgb]
    return [min(p[0] for p in points), min(p[1] for p in points), max(p[0] for p in points) + 1, max(p[1] for p in points) + 1]

rects = {
    'panel': bounds((2350, 145, 3000, 560), (51, 51, 56)),
    'composer': bounds((760, 1580, 2300, 1830), (60, 60, 64)),
    'bubble': bounds((1450, 180, 2300, 450), (126, 68, 38)),
}
divider = bounds((790, 568, 2278, 582), (49, 49, 54))
source_ink = bounds((2410, 405, 2850, 447), (184, 184, 185))
view_all_ink = bounds((2410, 465, 2830, 512), (133, 133, 136))
source_row_height = ((view_all_ink[1] + view_all_ink[3]) - (source_ink[1] + source_ink[3])) / 4
toolbar_bottom = next(y for y in range(145, 170) if im.getpixel((720, y)) == (31, 31, 36))
panel_first_row = next(x for x in range(rects['panel'][0], rects['panel'][2]) if im.getpixel((x, rects['panel'][1])) == (51, 51, 56))
panel_radius = (panel_first_row - rects['panel'][0]) / 2
# The reference is a 2x macOS screenshot; its 3024px width represents 1512 CSS px.
result = {'imageSize': im.size, 'pixelRatio': 2, 'palette': palette, 'rectangles': rects,
          'cssSizes': {name: {'width': (r[2]-r[0])/2, 'height': (r[3]-r[1])/2} for name,r in rects.items()},
          'inkBounds': {'workDivider': divider, 'source': source_ink, 'viewAll': view_all_ink},
          'layout': {'columnWidth': (divider[2] - divider[0])/2,
                     'panelWidthRatio': (rects['panel'][2]-rects['panel'][0])/im.width,
                     'rightInset': (im.width-rects['panel'][2])/2,
                     'panelTopAfterToolbar': (rects['panel'][1]-toolbar_bottom)/2,
                     'panelRadiusFromTopFill': panel_radius,
                     'sourceRowHeight': source_row_height,
                     'composerFillHeight': (rects['composer'][3]-rects['composer'][1])/2}}
(OUT / 'measurements.json').write_text(json.dumps(result, ensure_ascii=False, indent=2))
print(json.dumps(result, ensure_ascii=False, indent=2))
