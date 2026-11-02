//go:build cgo

//
// Copyright 2026 The InfiniFlow Authors. All Rights Reserved.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.
//

package parser

import (
	"context"
	"fmt"

	officeOxide "github.com/yfedoseev/office_oxide/go"
)

// PPTXParser parses both .pptx (OOXML) and .ppt (OLE binary)
// files via the office_oxide backend. The format field controls
// the container format passed to OpenFromBytes — "pptx" for
// ZIP-based OOXML presentations and "ppt" for the legacy binary
// OLE format.
type PPTXParser struct {
	format string
}

func NewPPTXParser() *PPTXParser {
	return &PPTXParser{format: "pptx"}
}

func (p *PPTXParser) String() string {
	return "PPTXParser"
}

func (p *PPTXParser) ConfigureFromSetup(setup map[string]any) {
	if p == nil || setup == nil {
		return
	}
}

// ParseWithResult emits one JSON item per slide with the slide's
// plain text. Mirrors the python parser.py:slides branch.
func (p *PPTXParser) ParseWithResult(ctx context.Context, filename string, data []byte) ParseResult {
	// p == nil guard: the struct is embedded by value in PPTParser and
	// always created via NewPPTXParser or the "ppt"-format constructor in
	// PPTParser, so this branch is unreachable from normal call paths.
	// Kept as defensive guard — a nil dereference here would obscure the
	// root cause behind a nil-pointer panic.
	if p == nil {
		return ParseResult{Err: fmt.Errorf("PPTXParser is nil")}
	}
	doc, err := officeOxide.OpenFromBytes(data, p.format)
	if err != nil {
		return ParseResult{Err: fmt.Errorf("presentation open: %w", err)}
	}
	defer doc.Close()

	text, err := doc.PlainText()
	if err != nil {
		return ParseResult{Err: fmt.Errorf("pptx plain-text: %w", err)}
	}

	// Split on form-feed (the python TxtParser convention used by
	// RAGFlow's slide parser) — each block becomes a JSON item.
	var items []map[string]any
	for i, raw := range strings.Split(text, "\f") {
		trimmed := strings.TrimSpace(raw)
		if trimmed == "" {
			continue
		}
		items = append(items, map[string]any{
			"text":         trimmed,
			"doc_type_kwd": "text",
			"slide_number": i + 1,
		})
	}
	if items == nil {
		items = []map[string]any{{"text": strings.TrimSpace(text), "doc_type_kwd": "text"}}
	}

	return ParseResult{
		OutputFormat: "json",
		File:         map[string]any{"name": filename, "format": p.format},
		JSON:         items,
	}
}
