#!/usr/bin/env python3
"""
dedupe.py 的单元测试

运行：
    python test_dedupe.py
"""

import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from dedupe import check, normalize, containment_score  # noqa: E402

DOMAINS = [
    {"id": "d1", "name": "计算机视觉", "aliases": ["CV", "computer vision"], "parent_id": None, "level": 1},
    {"id": "d2", "name": "自然语言处理", "aliases": ["NLP"], "parent_id": None, "level": 1},
    {"id": "d3", "name": "多模态", "aliases": ["multimodal"], "parent_id": None, "level": 1},
    {"id": "d4", "name": "图文理解与检索", "aliases": [], "parent_id": "d3", "level": 2},
    {"id": "d5", "name": "强化学习与决策", "aliases": ["RL"], "parent_id": None, "level": 1},
]

FAILED = 0


def ok(cond, label):
    global FAILED
    print(("  PASS  " if cond else "  FAIL  ") + label)
    if not cond:
        FAILED += 1


def main():
    print("\n[归一化]")
    ok(normalize("Computer Vision") == "computervision", "英文转小写并去空格")
    ok(normalize("多模态 学习") == "多模态学习", "中文去空格")
    ok(normalize("多模态、学习!") == "多模态学习", "去除中英文标点")
    ok(normalize("ＡＩ") == "ai", "全角转半角")
    ok(normalize("") == "", "空串安全")

    print("\n[包含度]")
    ok(containment_score("多模态", "多模态学习") > 0.5, "短串包含于长串，得分较高")
    ok(containment_score("多模态", "计算机视觉") == 0.0, "不相关得 0")
    ok(containment_score("abc", "abc") == 0.0, "完全相等不算包含（应走精确匹配）")

    print("\n[精确名称命中 → 应复用]")
    r = check("计算机视觉", DOMAINS)
    ok(r["recommendation"] == "reuse", "recommendation = reuse")
    ok(r["matched"]["id"] == "d1" and r["matched"]["match_type"] == "name", "命中 d1，类型 name")

    print("\n[大小写与空格差异也应命中]")
    r = check("computer  vision", DOMAINS)
    ok(r["recommendation"] == "reuse", "归一化后仍能命中别名")
    ok(r["matched"]["id"] == "d1" and r["matched"]["match_type"] == "alias", "类型 alias")

    print("\n[别名命中]")
    r = check("NLP", DOMAINS)
    ok(r["recommendation"] == "reuse" and r["matched"]["id"] == "d2", "NLP → 自然语言处理")

    print("\n[包含关系 → 交给 AI 判定]")
    r = check("多模态学习", DOMAINS)
    ok(r["recommendation"] == "ask_ai", "recommendation = ask_ai")
    ok(r["matched"] is None, "不应直接判定为命中")
    ok(any(c["id"] == "d3" for c in r["candidates"]), "候选里包含「多模态」")
    top = r["candidates"][0]
    ok(top["id"] == "d3", "相似度最高的应是「多模态」")
    ok(top["direction"] == "candidate_contains_node", "方向正确：候选词包含了已有节点名")

    print("\n[反向包含：候选词更短]")
    r = check("视觉", DOMAINS)
    ok(r["recommendation"] == "ask_ai", "「视觉」与「计算机视觉」构成包含关系")
    d = [c for c in r["candidates"] if c["id"] == "d1"]
    ok(bool(d), "候选里包含「计算机视觉」")
    ok(d and d[0]["direction"] == "node_contains_candidate", "方向正确：已有节点名包含了候选词")

    print("\n[已有节点名 → 应精确命中而非包含]")
    r = check("多模态", DOMAINS)
    ok(r["recommendation"] == "reuse", "「多模态」是已有节点名，应精确命中而非包含")

    print("\n[无命中 → 可以提议新建]")
    r = check("AI4Science", DOMAINS)
    ok(r["recommendation"] == "propose_new", "recommendation = propose_new")
    ok(r["matched"] is None and r["candidates"] == [], "无命中也无候选")

    print("\n[边界情况]")
    r = check("多模态", [])
    ok(r["recommendation"] == "propose_new", "领域树为空时可新建")
    r = check("", DOMAINS)
    ok(r["recommendation"] == "propose_new", "空候选串不报错")
    r = check("图像识别", DOMAINS)
    ok(r["recommendation"] == "propose_new", "「图像识别」与「计算机视觉」无包含关系，可新建")
    ok(r["total_domains"] == 5, "正确统计节点数")

    print()
    if FAILED:
        print("%d 项失败。" % FAILED)
        sys.exit(1)
    print("全部通过。")


if __name__ == "__main__":
    main()
