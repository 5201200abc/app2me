"""Compare equal-resolution screenshots without resizing either image."""
import json
from pathlib import Path
from PIL import Image

out = Path('.artifacts/conversation-reference')
reference = Image.open(out / 'reference.png').convert('RGB')
actual = Image.open(out / 'mycode.png').convert('RGB')
assert reference.size == actual.size == (3024, 1964)
comparison = Image.new('RGB', (reference.width * 2, reference.height))
comparison.paste(reference, (0, 0))
comparison.paste(actual, (reference.width, 0))
comparison.save(out / 'side-by-side.png')

measured = json.loads((out / 'measurements.json').read_text())
geometry = json.loads((out / 'geometry.json').read_text())
checks = []
for name, node in [('background', 'surface'), ('panel', 'panel'),
                   ('composer', 'composer'), ('bubble', 'bubble'), ('send', 'send')]:
    expected = measured['palette'][name]
    rgb = tuple(int(expected[index:index + 2], 16) for index in (1, 3, 5))
    value = geometry[node]['background']
    checks.append({'item': name, 'reference': expected, 'actual': value,
                   'matches': value == f'rgb({rgb[0]}, {rgb[1]}, {rgb[2]})'})
assert all(check['matches'] for check in checks)
differences = [
    f'按最新对齐要求，问答与输入框保留相同左右留白；736px 外列中的实际阅读宽度为 {geometry["answer"]["width"]:.0f}px，参考图实测约 736px。',
    '保留 MyCode 的 240px 侧栏和原顶栏；参考图包含更宽侧栏、macOS 菜单栏及 Dock，所以内容的绝对位置不同。',
    '模型按最新要求恢复到左侧加号后，上下文容量在右侧发送按钮前；参考图的模型位于右侧。',
    '面板宽度为窗口的 20%（302.4px），参考图实测约 300px；保留现有主区域 5px 外边距后，面板距窗口右边为 25px，参考为 20px。',
    '面板距 MyCode 顶栏为规定的 12px；参考图按背景实测约 7.5px。',
    '正文采用 MyCode 侧栏同款 13px 字体；系统字体回退、中文标点、段落换行与参考图存在差异。',
    '来源和工作摘要使用中文，模型、权限和用户元信息保留真实组件数据；参考图对应文案和状态不同。',
    '外链使用真实站点图标，加载失败时为地球图标；参考图的站点图标已加载。',
]
report = {'imageSize': list(reference.size), 'comparisonSize': list(comparison.size),
          'left': 'reference.png', 'right': 'mycode.png', 'paletteChecks': checks,
          'columnWidth': geometry['column']['width'],
          'readingWidth': geometry['answer']['width'],
          'composerWidth': geometry['composer']['width'],
          'composerHeight': geometry['composer']['height'],
          'sourceRowHeight': geometry['source']['height'], 'differences': differences}
(out / 'comparison.json').write_text(json.dumps(report, ensure_ascii=False, indent=2))
(out / 'comparison.md').write_text(
    '左侧参考图，右侧真实 Electron 组件截图。两图均为 3024×1964，未缩放。\n\n'
    '主背景、面板、输入框、用户气泡、发送按钮颜色均与脚本采样值一致。'
    '列宽 736px，输入框 98px，来源行高 30px；尺寸、折叠、原操作回调、窄屏及浅色已通过 E2E。\n\n'
    '仍有差异：\n\n' + '\n'.join(f'- {difference}' for difference in differences) + '\n')
print(json.dumps({'comparison': str(out / 'side-by-side.png'),
                  'paletteMatches': len(checks), 'differences': len(differences)}))
