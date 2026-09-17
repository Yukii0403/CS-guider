#!/usr/bin/env python3
"""
从 domain-tree.json 生成 domain-tree.md。

为什么要有这个脚本：
    领域树有两份用途不同的文件——
      domain-tree.json  机器可读，供 dedupe.py 做查重
      domain-tree.md    模型可读，供 AI 出选项时查阅
    两份手工维护必然会漂移（改了一边忘另一边）。所以 .md 是**生成产物**，
    单一数据源是 .json。

用法：
    python render_domain_tree.py            # 重新生成 domain-tree.md
    python render_domain_tree.py --check    # 只检查是否同步，不写入（CI/自检用）
"""

import argparse
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
REFS = os.path.join(HERE, '..', 'references')
SRC = os.path.join(REFS, 'domain-tree.json')
OUT = os.path.join(REFS, 'domain-tree.md')

HEADER = """<!-- 本文件由 render_domain_tree.py 从 domain-tree.json 生成，请勿直接编辑。 -->
<!-- 要改节点，改 domain-tree.json，然后重新运行该脚本。 -->

# 领域树 · 第一层

**这是选项式追问的唯一来源。** 出选项时只能从下表选取，不得自由造词。

如果用户的表述落在某个节点的常见叫法（aliases）里，直接映射到该节点，不要再追问。

| # | 一级方向 | 常见叫法 | 一句话说明 | 典型子方向 |
|---|---|---|---|---|
"""

FOOTER = """
## 使用规则

1. **出选项**：从下表挑 2–4 个，优先挑与用户表述最接近的。每个选项后面要跟一句人话解释（用"一句话说明"那一列的说法，别用术语）。
2. **映射**：用户说的话若命中「常见叫法」，直接落到对应节点，**不要再追问**。
3. **新节点**：下表没有的，先走 `scripts/dedupe.py` 查重；四步全未命中才提议新建，并让用户确认。
4. **上限**：本层节点数不超过 12 个。要加新的，先想清楚能不能并进已有的。
"""


def load_nodes():
    with open(SRC, encoding='utf-8') as f:
        data = json.load(f)
    return data.get('nodes', [])


def render(nodes):
    rows = []
    for i, n in enumerate(nodes, 1):
        aliases = '、'.join(n.get('aliases') or [])
        children = '、'.join(n.get('children_hint') or [])
        rows.append(
            '| {i} | **{name}** | {aliases} | {oneliner} | {children} |'.format(
                i=i,
                name=n.get('name', ''),
                aliases=aliases,
                oneliner=n.get('oneliner', ''),
                children=children,
            )
        )
    return HEADER + '\n'.join(rows) + '\n' + FOOTER


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--check', action='store_true', help='只检查是否同步，不写入')
    args = ap.parse_args()

    nodes = load_nodes()
    content = render(nodes)

    if args.check:
        if not os.path.exists(OUT):
            print('✗ domain-tree.md 不存在，请运行 render_domain_tree.py')
            sys.exit(1)
        current = open(OUT, encoding='utf-8').read()
        if current != content:
            print('✗ domain-tree.md 与 domain-tree.json 不同步')
            print('  请运行：python render_domain_tree.py')
            sys.exit(1)
        print('✓ domain-tree.md 与 domain-tree.json 同步（%d 个节点）' % len(nodes))
        return

    with open(OUT, 'w', encoding='utf-8', newline='\n') as f:
        f.write(content)
    print('✓ 已生成 domain-tree.md（%d 个节点）' % len(nodes))


if __name__ == '__main__':
    main()
