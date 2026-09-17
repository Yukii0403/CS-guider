#!/usr/bin/env python3
"""
领域树查重（四步查重的前三步）

四步查重里，前三步是完全确定性的，不应该交给模型凭感觉判断：
  ① 归一化      小写、去空格与标点
  ② 别名匹配    同时比对 name 与 aliases[]
  ③ 包含匹配    上下位包含关系（"多模态" ⊂ "多模态学习"）
  ④ AI 判定     模型从候选里选，不允许自由造词   ← 不在本脚本内

本脚本负责 ①②③，输出结构化结果供第 ④ 步使用。

用法：
    python dedupe.py --candidate "多模态学习" --domains domains.json
    python dedupe.py --candidate "CV" --domains domains.json --json

输出（JSON）：
    {
      "candidate": "多模态学习",
      "normalized": "多模态学习",
      "total_domains": 12,
      "matched": null | {"id":..., "name":..., "match_type": "name|alias"},
      "candidates": [{"id":..., "name":..., "match_type": "containment",
                      "score": 0.84, "direction": "candidate_in_node"}],
      "recommendation": "reuse" | "ask_ai" | "propose_new"
    }

依赖：仅标准库。
"""

import argparse
import json
import sys
import unicodedata

# 归一化时需要剔除的字符（ASCII 标点 + 常见全角标点）
PUNCT = set(
    " \t\r\n-_/\\.,;:!?()[]{}<>\"'`~@#$%^&*+=|"
    "、。，；：！？（）【】《》「」『』·—…～　"
)


def normalize(text):
    """小写、转半角、去空格与标点。"""
    if not text:
        return ""
    s = unicodedata.normalize("NFKC", str(text)).lower()
    return "".join(ch for ch in s if ch not in PUNCT)


def load_domains(path):
    if not path:
        return []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        return []
    except json.JSONDecodeError as e:
        print("domains 文件不是合法 JSON：%s" % e, file=sys.stderr)
        sys.exit(2)

    if isinstance(data, dict):
        # 兼容 {"domains": [...]} 与 {"rows": [...]} 两种包装
        for key in ("domains", "rows", "data", "items"):
            if key in data and isinstance(data[key], list):
                return data[key]
        return []
    return data if isinstance(data, list) else []


def containment_score(a, b):
    """
    a 与 b 的包含程度。返回 0–1，0 表示互不包含。
    用较短串占较长串的比例衡量——比例越高，越可能是同一概念的粗细粒度。
    """
    if not a or not b or a == b:
        return 0.0
    if a not in b and b not in a:
        return 0.0
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    return len(short) / len(long_)


def check(candidate, domains):
    norm = normalize(candidate)
    result = {
        "candidate": candidate,
        "normalized": norm,
        "total_domains": len(domains),
        "matched": None,
        "candidates": [],
        "recommendation": "propose_new",
    }

    if not norm:
        result["recommendation"] = "propose_new"
        return result

    # ---- ② 精确名 / 别名匹配 ----
    for d in domains:
        if normalize(d.get("name")) == norm:
            result["matched"] = {
                "id": d.get("id"),
                "name": d.get("name"),
                "match_type": "name",
            }
            result["recommendation"] = "reuse"
            return result
        for alias in d.get("aliases") or []:
            if normalize(alias) == norm:
                result["matched"] = {
                    "id": d.get("id"),
                    "name": d.get("name"),
                    "match_type": "alias",
                    "matched_alias": alias,
                }
                result["recommendation"] = "reuse"
                return result

    # ---- ③ 包含匹配 ----
    cands = []
    for d in domains:
        names = [d.get("name")] + list(d.get("aliases") or [])
        best = 0.0
        for n in names:
            nn = normalize(n)
            s = containment_score(norm, nn)
            if s > best:
                best = s
        if best > 0:
            node_norm = normalize(d.get("name"))
            cands.append(
                {
                    "id": d.get("id"),
                    "name": d.get("name"),
                    "match_type": "containment",
                    "score": round(best, 2),
                    # 明确描述包含的**方向**，避免"谁包含谁"读反：
                    #   node_contains_candidate → 已有节点名里含有候选词（候选更细）
                    #   candidate_contains_node → 候选词里含有已有节点名（候选更粗）
                    "direction": (
                        "node_contains_candidate"
                        if norm in node_norm
                        else "candidate_contains_node"
                    ),
                }
            )

    cands.sort(key=lambda x: x["score"], reverse=True)
    result["candidates"] = cands[:5]

    if cands:
        # 包含关系很强时视为疑似重复，交给第 ④ 步判定
        result["recommendation"] = "ask_ai"
    else:
        result["recommendation"] = "propose_new"

    return result


def main():
    ap = argparse.ArgumentParser(description="领域树查重（前三步）")
    ap.add_argument("--candidate", required=True, help="待检查的新领域名称")
    ap.add_argument("--domains", default="domains.json", help="领域树 JSON 文件路径")
    ap.add_argument("--json", action="store_true", help="只输出 JSON")
    args = ap.parse_args()

    domains = load_domains(args.domains)
    res = check(args.candidate, domains)

    if args.json:
        print(json.dumps(res, ensure_ascii=False, indent=2))
        return

    print("候选：%s" % res["candidate"])
    print("归一化：%s" % res["normalized"])
    print("领域树节点数：%d" % res["total_domains"])
    print("")

    if res["matched"]:
        m = res["matched"]
        kind = "名称完全一致" if m["match_type"] == "name" else "命中别名「%s」" % m.get("matched_alias")
        print("→ 命中已有节点：%s（%s）" % (m["name"], kind))
        print("→ 建议：复用，不要新建")
        return

    if res["candidates"]:
        print("→ 未精确命中，但发现 %d 个疑似重叠节点：" % len(res["candidates"]))
        for c in res["candidates"]:
            print("   - %s  相似度 %.2f  (%s)" % (c["name"], c["score"], c["direction"]))
        print("→ 建议：交给 AI 从以上候选中选择一个，或确认确实需要新建")
        return

    print("→ 未命中任何节点")
    print("→ 建议：可以提议新建")


if __name__ == "__main__":
    main()
