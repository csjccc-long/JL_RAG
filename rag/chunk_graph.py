#
#  Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
#
#  Licensed under the Apache License, Version 2.0 (the "License");
#  you may not use this file except in compliance with the License.
#  You may obtain a copy of the License at
#
#      http://www.apache.org/licenses/LICENSE-2.0
#
#  Unless required by applicable law or agreed to in writing, software
#  distributed under the License is distributed on an "AS IS" BASIS,
#  WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
#  See the License for the specific language governing permissions and
#  limitations under the License.
#
"""Pure helpers that turn parsed chunks into a deterministic layered graph.

No LLM, no database: the caller passes plain chunk dicts, which keeps this
module cheap to unit-test.
"""
import re
from collections import Counter

HEADING_RE = re.compile(r"第\s*([一二三四五六七八九十百零〇两\d]{1,5})\s*(章|节|条|部分|编)")
SENT_SPLIT_RE = re.compile(r"[。；！？!?;\n]+")
CJK_RE = re.compile(r"[\u4e00-\u9fff]{2,}")
QUOTED_RE = re.compile(r"《([^》]{1,24})》|「([^」]{1,24})」|“([^”]{1,24})”")
CODE_RE = re.compile(r"\b([A-Z][A-Z0-9_\-]{2,24})\b")
NUMCODE_RE = re.compile(r"\b((?:ISO|GB|IEC|ASTM|DIN)[\s/]?\d{2,6}(?:[-—]\d{1,4})?)\b")
MEASURE_RE = re.compile(r"(\d{1,6}(?:\.\d{1,2})?)\s*(万元|元|%|天|日|个|月|年|小时|次|件|台)")

LEVEL_OF_KIND = {"编": 0, "部分": 0, "章": 1, "节": 2, "条": 3}
TYPE_OF_LEVEL = {0: "part", 1: "chapter", 2: "section", 3: "article"}

STOP_CHARS = set("的了着是在和与或及等为则须应可由按对将从以其该本被把并且但而就都也很更最不没未无有")
EDGE_STOP_CHARS = set("第的了着是在和与或及等为则须应可由按对将从以其该本被把并且但而就都也很更最不没未无有后内时中上下个")
STOP_GRAMS = {
    "可以", "进行", "相关", "以上", "以下", "应当", "不得",
    "须经", "方可", "并且", "或者", "以及", "按照", "根据", "对于", "由于", "通过",
}


def clean(text):
    if not isinstance(text, str):
        text = "" if text is None else str(text)
    return re.sub(r"\s+", " ", text).strip()


def truncate(text, limit):
    text = clean(text)
    if len(text) <= limit:
        return text
    return text[: max(limit - 1, 1)] + "…"


def headings(text):
    """[(start, end, level, kind, number, title)] for inline Chinese headings."""
    matches = list(HEADING_RE.finditer(text))
    out = []
    for idx, m in enumerate(matches):
        kind = m.group(2)
        level = LEVEL_OF_KIND.get(kind, 1)
        nxt = matches[idx + 1].start() if idx + 1 < len(matches) else len(text)
        title = clean(text[m.end(): nxt])
        title = re.split(r"[，,。；;：:（(]", title)[0]
        out.append((m.start(), m.end(), level, kind, m.group(1), title[:40]))
    return out


def sentences(text, limit=40):
    parts = []
    for raw in SENT_SPLIT_RE.split(text):
        s = clean(raw)
        if len(s) >= 8:
            parts.append(s)
        if len(parts) >= limit:
            break
    return parts


def keyword_candidates(text, counter):
    """Explicit terms (codes, quoted titles, measures) plus n-gram frequencies."""
    explicit = set()
    for m in QUOTED_RE.finditer(text):
        term = clean(next((g for g in m.groups() if g), ""))
        if 2 <= len(term) <= 24:
            explicit.add(term)
    for m in CODE_RE.finditer(text):
        explicit.add(m.group(1))
    for m in NUMCODE_RE.finditer(text):
        explicit.add(clean(m.group(1)))
    for m in MEASURE_RE.finditer(text):
        explicit.add(clean(m.group(0)))

    for run in CJK_RE.findall(text):
        run = run[:400]
        for size in (4, 3, 2):
            for i in range(0, len(run) - size + 1):
                g = run[i: i + size]
                if g in STOP_GRAMS or any(ch in STOP_CHARS for ch in g):
                    continue
                if g[0] in EDGE_STOP_CHARS or g[-1] in EDGE_STOP_CHARS:
                    continue
                counter[g] += 1
    return explicit


def pick_keywords(counter, limit=36):
    """Frequent n-grams, merging fragments into the longest dominant phrase.

    A shorter gram is dropped when a longer picked gram covers it at least 75%
    of the time, so "质保" folds into "质保期" while "采购" survives next to
    "采购员" when it is clearly more frequent on its own.
    """
    min_count = {2: 4, 3: 3, 4: 3, 5: 3}
    ranked = [g for g, c in counter.items() if c >= min_count.get(len(g), 4)]
    ranked.sort(key=lambda g: (counter[g], len(g)), reverse=True)
    picked = []
    for g in ranked:
        c = counter[g]
        skip = False
        for p in list(picked):
            if g in p and counter[p] >= 0.75 * c:
                skip = True
                break
            if p in g and c >= 0.75 * counter[p]:
                picked.remove(p)
        if skip:
            continue
        picked.append(g)
    picked.sort(key=lambda g: (counter[g] * len(g), len(g)), reverse=True)
    return picked[:limit]


def build_graph(docs, chunks_by_doc, granularity="sentence"):
    """docs: [{id, name, parser_id}]; chunks_by_doc: {doc_id: [chunk dict]}."""
    nodes = {}
    edges = {}
    kw_counter = Counter()
    kw_sources = {}

    def add_node(node_id, label, ntype, description="", **meta):
        if node_id in nodes:
            return
        item = {
            "id": node_id,
            "label": label or node_id,
            "type": ntype,
            "description": description,
            "weight": 0,
        }
        item.update({k: v for k, v in meta.items() if v is not None})
        nodes[node_id] = item

    def add_edge(source, target, etype, weight=1, label=""):
        if not source or not target or source == target:
            return
        key = (source, target, etype)
        if key in edges:
            edges[key]["weight"] += 1
            return
        edges[key] = {
            "id": f"{etype}:{source}->{target}",
            "source": source,
            "target": target,
            "type": etype,
            "label": label,
            "weight": weight,
        }

    doc_stats = []
    for doc in docs:
        chunks = chunks_by_doc.get(doc["id"]) or []
        if not chunks:
            continue
        doc_node_id = f"doc:{doc['id']}"
        add_node(
            doc_node_id,
            doc["name"],
            "document",
            f"{len(chunks)} 个块 · {doc.get('parser_id') or 'naive'}",
            doc_id=doc["id"],
            doc_name=doc["name"],
        )
        doc_stats.append({"id": doc["id"], "name": doc["name"], "chunk_count": len(chunks)})

        sections = []
        section_order = {}
        chunk_meta = []

        for idx, chunk in enumerate(chunks):
            cid = chunk["id"]
            content = chunk["content"]
            chunk_node_id = f"chunk:{cid}"
            add_node(
                chunk_node_id,
                truncate(content, 34) or f"块 {idx + 1}",
                "chunk",
                truncate(content, 160),
                doc_id=doc["id"],
                doc_name=doc["name"],
                order=idx,
                page=chunk.get("page"),
                value=len(content),
                chunk_index=idx + 1,
            )
            add_edge(doc_node_id, chunk_node_id, "contains")

            covered = []
            for _start, _end, level, kind, number, title in headings(content):
                key = f"{kind}:{number}:{title[:16]}"
                sec = section_order.get(key)
                if sec is None:
                    sec = {
                        "id": f"sec:{doc['id']}:{len(sections)}",
                        "level": level,
                        "kind": kind,
                        "number": number,
                        "title": title or f"第{number}{kind}",
                        "parent": None,
                        "order": len(sections),
                    }
                    section_order[key] = sec
                    sections.append(sec)
                covered.append(sec["id"])

            chunk_meta.append({"id": chunk_node_id, "content": content, "cid": cid, "covered": covered})

        stack = []
        for sec in sections:
            while stack and stack[-1]["level"] >= sec["level"]:
                stack.pop()
            sec["parent"] = stack[-1]["id"] if stack else None
            stack.append(sec)
            add_node(
                sec["id"],
                truncate(sec["title"], 22),
                TYPE_OF_LEVEL.get(sec["level"], "section"),
                f"{sec['kind']} {sec['number']} · {sec['title']}",
                doc_id=doc["id"],
                doc_name=doc["name"],
                level=sec["level"],
                number=sec["number"],
                order=sec["order"],
            )
            add_edge(sec["parent"] or doc_node_id, sec["id"], "contains")

        chunk_ids = [cm["id"] for cm in chunk_meta]
        for cm in chunk_meta:
            for sec_id in cm["covered"]:
                add_edge(cm["id"], sec_id, "covers")

            if granularity == "sentence":
                body = HEADING_RE.sub(" ", cm["content"])
                for s_idx, sent in enumerate(sentences(body)):
                    sid = f"sent:{cm['cid']}:{s_idx}"
                    add_node(
                        sid,
                        truncate(sent, 26),
                        "sentence",
                        sent,
                        doc_id=doc["id"],
                        doc_name=doc["name"],
                        order=s_idx,
                        chunk_id=cm["cid"],
                        value=len(sent),
                    )
                    add_edge(cm["id"], sid, "contains")
                    if s_idx > 0:
                        add_edge(f"sent:{cm['cid']}:{s_idx - 1}", sid, "next")

            explicit = keyword_candidates(cm["content"], kw_counter)
            for kw in explicit:
                kw_counter[kw] += 6
                kw_sources.setdefault(kw, set()).add(cm["id"])

        for prev, nxt in zip(chunk_ids, chunk_ids[1:]):
            add_edge(prev, nxt, "next")

    for kw in pick_keywords(kw_counter):
        kw_id = f"kw:{kw}"
        add_node(kw_id, truncate(kw, 20), "keyword", kw)
        for src in kw_sources.get(kw, set()):
            add_edge(src, kw_id, "mentions")

    for e in edges.values():
        for endpoint in (e["source"], e["target"]):
            if endpoint in nodes:
                nodes[endpoint]["weight"] = nodes[endpoint].get("weight", 0) + 1

    stats = {
        "documents": sum(1 for n in nodes.values() if n["type"] == "document"),
        "chapters": sum(1 for n in nodes.values() if n["type"] == "chapter"),
        "articles": sum(1 for n in nodes.values() if n["type"] in ("article", "section")),
        "chunks": sum(1 for n in nodes.values() if n["type"] == "chunk"),
        "sentences": sum(1 for n in nodes.values() if n["type"] == "sentence"),
        "keywords": sum(1 for n in nodes.values() if n["type"] == "keyword"),
        "nodes": len(nodes),
        "edges": len(edges),
    }
    return {
        "nodes": list(nodes.values()),
        "edges": list(edges.values()),
        "stats": stats,
        "documents": doc_stats,
        "granularity": granularity,
    }
