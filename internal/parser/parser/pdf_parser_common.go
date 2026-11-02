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
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"log/slog"
	"ragflow/internal/common"
	"sort"
	"strings"

	deepdocpdf "ragflow/internal/deepdoc/parser/pdf"
	"ragflow/internal/deepdoc/parser/pdf/inference"
	pdflayout "ragflow/internal/deepdoc/parser/pdf/layout"
	"ragflow/internal/deepdoc/parser/pdf/util"
	deepdoctype "ragflow/internal/deepdoc/parser/type"
	"ragflow/internal/utility"
)

// ErrPDFEngineUnavailable is returned by PDFParser.ParseWithResult
// when the current build cannot construct the DeepDOC PDF backend.
// The normal reason is a non-cgo build, because the pdfoxide bridge
// is compiled behind `//go:build cgo`.
var ErrPDFEngineUnavailable = errors.New("parser: PDF backend unavailable in this build")

var supportedPDFParseMethods = map[string]struct{}{
	"":           {},
	"deepdoc":    {},
	"plain_text": {},
	"paddleocr":  {},
	"somark":     {},
}

type PDFParser struct {
	ParserType string // DeepDoc, PaddleOCR, SoMark
	Model      string // DeepDoc@buildin@ragflow
	LibType    string // pdf_oxide, used by DeepDoc

	FlattenMediaToText bool
	RemoveTOC          bool
	RemoveHeaderFooter bool
	EnableMultiColumn  bool
	OutputFormat       string
	ParseMethod        string
	// Pages restricts parsing to these 1-indexed inclusive page ranges.
	// nil/empty means parse all pages. Populated by ConfigureFromSetup from
	// the filetype setup map and forwarded to the deepdoc ParserConfig.
	Pages                             [][]int
	PaddleOCRBaseURL                  string
	PaddleOCRAPIKey                   string
	PaddleOCRAlgorithm                string
	SoMarkBaseURL                     string
	SoMarkAPIKey                      string
	SoMarkImageFormat                 string
	SoMarkFormulaFormat               string
	SoMarkTableFormat                 string
	SoMarkCSFormat                    string
	SoMarkEnableTextCrossPage         bool
	SoMarkEnableTableCrossPage        bool
	SoMarkEnableTitleLevelRecognition bool
	SoMarkEnableInlineImage           bool
	SoMarkEnableTableImage            bool
	SoMarkEnableImageUnderstanding    bool
	SoMarkKeepHeaderFooter            bool
}

func NewPDFParser() *PDFParser {
	return &PDFParser{
		ParserType:                     "DeepDoc",
		Model:                          "DeepDoc@buildin@ragflow",
		LibType:                        "pdf_oxide",
		ParseMethod:                    "deepdoc",
		OutputFormat:                   "json",
		PaddleOCRAlgorithm:             "PaddleOCR-VL",
		SoMarkBaseURL:                  "https://somark.cn/api/v1",
		SoMarkImageFormat:              "url",
		SoMarkFormulaFormat:            "latex",
		SoMarkTableFormat:              "html",
		SoMarkCSFormat:                 "image",
		SoMarkEnableInlineImage:        true,
		SoMarkEnableTableImage:         true,
		SoMarkEnableImageUnderstanding: true,
	}
}

func (p *PDFParser) String() string {
	return "PDFParser"
}

func (p *PDFParser) ConfigureFromSetup(setup map[string]any) {
	if p == nil || setup == nil {
		return
	}
	if v, ok := setup["flatten_media_to_text"].(bool); ok {
		p.FlattenMediaToText = v
	}
	if v, ok := setup["remove_toc"].(bool); ok {
		p.RemoveTOC = v
	}
	if v, ok := setup["remove_header_footer"].(bool); ok {
		p.RemoveHeaderFooter = v
	}
	if v, ok := setup["enable_multi_column"].(bool); ok {
		p.EnableMultiColumn = v
	}
	if v, ok := setup["parse_method"].(string); ok && v != "" {
		p.ParseMethod = v
	}
	if v, ok := setup["output_format"].(string); ok && v != "" {
		p.OutputFormat = v
	}
	if v, ok := setup["paddleocr_base_url"].(string); ok && v != "" {
		p.PaddleOCRBaseURL = v
	}
	if v, ok := setup["paddleocr_api_key"].(string); ok {
		p.PaddleOCRAPIKey = v
	}
	if v, ok := setup["paddleocr_algorithm"].(string); ok && v != "" {
		p.PaddleOCRAlgorithm = v
	}
	if v, ok := setup["somark_base_url"].(string); ok && v != "" {
		p.SoMarkBaseURL = v
	}
	if v, ok := setup["somark_api_key"].(string); ok {
		p.SoMarkAPIKey = v
	}
	if v, ok := setup["somark_image_format"].(string); ok && v != "" {
		p.SoMarkImageFormat = v
	}
	if v, ok := setup["somark_formula_format"].(string); ok && v != "" {
		p.SoMarkFormulaFormat = v
	}
	if v, ok := setup["somark_table_format"].(string); ok && v != "" {
		p.SoMarkTableFormat = v
	}
	if v, ok := setup["somark_cs_format"].(string); ok && v != "" {
		p.SoMarkCSFormat = v
	}
	if v, ok := setup["somark_enable_text_cross_page"].(bool); ok {
		p.SoMarkEnableTextCrossPage = v
	}
	if v, ok := setup["somark_enable_table_cross_page"].(bool); ok {
		p.SoMarkEnableTableCrossPage = v
	}
	if v, ok := setup["somark_enable_title_level_recognition"].(bool); ok {
		p.SoMarkEnableTitleLevelRecognition = v
	}
	if v, ok := setup["somark_enable_inline_image"].(bool); ok {
		p.SoMarkEnableInlineImage = v
	}
	if v, ok := setup["somark_enable_table_image"].(bool); ok {
		p.SoMarkEnableTableImage = v
	}
	if v, ok := setup["somark_enable_image_understanding"].(bool); ok {
		p.SoMarkEnableImageUnderstanding = v
	}
	if v, ok := setup["somark_keep_header_footer"].(bool); ok {
		p.SoMarkKeepHeaderFooter = v
	}
	if raw, ok := setup["pages"]; ok {
		// Request-layer validation (NormalizeParserConfigPages) already
		// rejects invalid ranges at the API boundary. At parse time the input
		// should already be normalized; degrade to "parse all pages" rather
		// than failing the parse if an unexpected shape slips through.
		if pages, err := utility.NormalizePDFPages(raw); err != nil {
			slog.Warn("ConfigureFromSetup: invalid pages range, falling back to all pages",
				"raw", raw, "err", err)
		} else {
			p.Pages = pages
		}
	}
}

func normalizePDFParseMethod(raw string) string {
	method := strings.ToLower(strings.TrimSpace(raw))
	switch {
	case strings.HasSuffix(method, "@paddleocr"):
		return "paddleocr"
	case strings.HasSuffix(method, "@somark"):
		return "somark"
	}
	switch method {
	case "plaintext":
		return "plain_text"
	}
	return method
}

func (p *PDFParser) validateParseMethod() error {
	method := normalizePDFParseMethod(p.ParseMethod)
	if _, ok := supportedPDFParseMethods[method]; ok {
		return nil
	}
	return fmt.Errorf("parser: unsupported PDF parse_method %q (Go currently supports: deepdoc, plain_text, paddleocr, somark; tenant-resolved custom IMAGE2TEXT/VLM model names are not supported in the Go parser layer)", p.ParseMethod)
}

func emptyPDFResult(filename string) ParseResult {
	return ParseResult{
		OutputFormat: "json",
		File: map[string]any{
			"name":       filename,
			"page_count": 0,
			"outline":    []map[string]any{},
		},
		JSON: []map[string]any{{"text": "", "doc_type_kwd": "text"}},
	}
}

func deepDocAnalyzerFromEnv() deepdoctype.DocAnalyzer {
	baseURL := strings.TrimSpace(common.GetEnv(common.EnvDeepDocURL))
	if baseURL == "" {
		return &deepdocpdf.MockDocAnalyzer{Healthy: true}
	}
	client, err := inference.NewClient(baseURL)
	if err != nil {
		return &deepdocpdf.MockDocAnalyzer{Healthy: true}
	}
	if !client.Health() {
		return &deepdocpdf.MockDocAnalyzer{Healthy: true}
	}
	// Wrap with Redis-backed cache (1h TTL) so repeated
	// DLA/TSR/OCR inference on the same image is served from
	// Redis instead of re-hitting the DeepDoc HTTP service. The
	// wrapper is a no-op when Redis is not configured (see
	// internal/deepdoc/parser/pdf/inference/cache.go).
	return inference.NewDocAnalyzerCache(client, inference.DefaultCacheTTL)
}

func pdfParseResultToJSON(filename string, parsed *deepdoctype.ParseResult) ParseResult {
	return pdfParseResultToJSONWithOptions(filename, parsed, pdfPostProcessOptions{})
}

func pdfParseResultToJSONWithOptions(filename string, parsed *deepdoctype.ParseResult, opts pdfPostProcessOptions) ParseResult {
	if parsed == nil {
		return ParseResult{Err: fmt.Errorf("parser: nil DeepDOC PDF result for %s", filename)}
	}
	processed := *parsed
	processed.Sections = append([]deepdoctype.Section(nil), parsed.Sections...)
	processed.Outlines = append([]deepdoctype.Outline(nil), parsed.Outlines...)
	if opts.enableMultiColumn && opts.pageWidth <= 0 {
		opts.pageWidth = firstPDFPageWidth(processed.PageWidth)
	}
	applyPDFPostProcess(&processed, opts)

	items := pdflayout.SectionsToJSON(processed.Sections)
	if len(items) == 0 {
		items = []map[string]any{{"text": "", "doc_type_kwd": "text"}}
	}
	for i := range items {
		if layoutType, _ := items[i]["layout_type"].(string); layoutType != "" {
			items[i]["layout"] = layoutType
		}
		if normalized := normalizePDFPositions(items[i]["_pdf_positions"]); len(normalized) > 0 {
			items[i]["_pdf_positions"] = normalized
			items[i]["positions"] = normalized
			if _, ok := items[i]["page_number"]; !ok {
				items[i]["page_number"] = firstPageNumber(normalized)
			}
		}
		normalizePDFDocType(items[i])
		if img, _ := items[i]["image"].(string); img != "" {
			items[i]["image"] = "data:image/png;base64," + img
		}
	}
	// JSON is consumed by the chunker, which re-acquires the source PDF
	// and crops image/table sections on demand. Release the engine now.
	processed.Close()
	return ParseResult{
		OutputFormat: "json",
		File: map[string]any{
			"name":       filename,
			"page_count": len(processed.PageHeight),
			"outline":    outlinesToFileMeta(processed.Outlines),
		},
		JSON: items,
	}
}

func pdfParseResultToMarkdownWithOptions(filename string, parsed *deepdoctype.ParseResult, opts pdfPostProcessOptions) ParseResult {
	if parsed == nil {
		return ParseResult{Err: fmt.Errorf("parser: nil DeepDOC PDF result for %s", filename)}
	}
	processed := *parsed
	processed.Sections = append([]deepdoctype.Section(nil), parsed.Sections...)
	processed.Outlines = append([]deepdoctype.Outline(nil), parsed.Outlines...)
	if opts.enableMultiColumn && opts.pageWidth <= 0 {
		opts.pageWidth = firstPDFPageWidth(processed.PageWidth)
	}
	applyPDFPostProcess(&processed, opts)
	// Markdown embeds figure images inline, so crop figures here while
	// the engine is still alive. The chunker path crops image/table
	// chunks on demand instead.
	cropMarkdownFigures(&processed)
	processed.Close()

	return ParseResult{
		OutputFormat: "markdown",
		File: map[string]any{
			"name":       filename,
			"page_count": len(processed.PageHeight),
			"outline":    outlinesToFileMeta(processed.Outlines),
		},
		Markdown: sectionsToMarkdown(processed.Sections),
	}
}

func outlinesToFileMeta(outlines []deepdoctype.Outline) []map[string]any {
	if len(outlines) == 0 {
		return []map[string]any{}
	}
	result := make([]map[string]any, 0, len(outlines))
	for _, o := range outlines {
		result = append(result, map[string]any{
			"title":       o.Title,
			"level":       o.Level,
			"page_number": o.PageNumber,
		})
	}
	return result
}

func firstPageNumber(raw any) int {
	positions, ok := raw.([][]any)
	if !ok || len(positions) == 0 || len(positions[0]) == 0 {
		return 0
	}
	switch v := positions[0][0].(type) {
	case int:
		return v
	case int64:
		return int(v)
	case float64:
		return int(v)
	default:
		return 0
	}
}

func inlinePNGDataURL(raw string) string {
	if raw == "" {
		return ""
	}
	if strings.HasPrefix(raw, "data:image/") {
		return raw
	}
	if _, err := base64.StdEncoding.DecodeString(raw); err != nil {
		return raw
	}
	return "data:image/png;base64," + raw
}

func sectionsToMarkdown(sections []deepdoctype.Section) string {
	var b strings.Builder
	for _, section := range sections {
		layoutType := strings.TrimSpace(section.LayoutType)
		if layoutType == deepdoctype.LayoutTypeTitle {
			b.WriteString("\n## ")
		}
		if layoutType == deepdoctype.LayoutTypeFigure && section.Image != "" {
			b.WriteString("\n![Image](")
			b.WriteString(inlinePNGDataURL(section.Image))
			b.WriteString(")")
			continue
		}
		b.WriteString(section.Text)
		b.WriteByte('\n')
	}
	return b.String()
}

// cropMarkdownFigures crops inline images for figure sections so the
// Markdown output can embed them. It mirrors the figure branch of the
// former Parse.fillSectionImages, but runs only for the Markdown path
// (the JSON path defers cropping to the chunker). The engine is read
// from result.Engine; callers must Close the result afterwards.
func cropMarkdownFigures(result *deepdoctype.ParseResult) {
	engine := result.Engine
	if engine == nil || len(result.PageHeight) == 0 {
		return
	}
	// Render each page at most once across all figures. A PDF can have many
	// figures on the same page, so a cache shared across the section loop
	// avoids re-rendering the page for every figure.
	//
	// result.Sections is ordered by page, so once we advance to a figure whose
	// minimum page is P, no later figure references a page < P. We therefore
	// keep only a sliding window of page images: pages strictly below the
	// current figure's minimum page are evicted. This bounds memory to the
	// current figure's page span (typically one page, a few at most for a
	// cross-page figure) instead of caching the whole PDF.
	pageCache := make(map[int]image.Image)
	renderPage := func(pn int) image.Image {
		if img, ok := pageCache[pn]; ok {
			return img
		}
		img, err := deepdocpdf.RenderPageToImage(engine, pn)
		if err != nil || img == nil {
			slog.Warn("cropMarkdownFigures: render failed, skipping figure",
				"page", pn, "err", err)
			pageCache[pn] = nil
			return nil
		}
		pageCache[pn] = img
		return img
	}

	for i := range result.Sections {
		sec := &result.Sections[i]
		if sec.LayoutType != deepdoctype.LayoutTypeFigure {
			continue
		}
		if len(sec.Positions) == 0 {
			continue
		}
		// Minimum page this figure touches; used both to prune stale cache
		// entries and to bound the window.
		minPage := -1
		pages := make(map[int]struct{})
		for _, pos := range sec.Positions {
			for _, pn := range pos.PageNumbers {
				pages[pn] = struct{}{}
				if pn < minPage || minPage < 0 {
					minPage = pn
				}
			}
		}
		// Evict page images that no later figure can reference (all future
		// figures start at page >= minPage).
		for pn := range pageCache {
			if pn < minPage {
				delete(pageCache, pn)
			}
		}
		// Collect every distinct page this section spans so CropSectionByDLA
		// can crop and vertically concatenate each page (mirroring Python's
		// cropout multi-page branch). Single-page figures still render exactly
		// one page, and the pageCache above guarantees a page is rendered at
		// most once even when several figures share it.
		single := make(map[int]image.Image, len(pages))
		for pn := range pages {
			if img := renderPage(pn); img != nil {
				single[pn] = img
			}
		}
		if len(single) == 0 {
			continue
		}
		if dla := util.CropSectionByDLA(*sec, result.DLARegions, single); dla != "" {
			sec.Image = dla
			continue
		}
		sec.Image = util.CropSectionImage(sec.PositionTag, single, deepdoctype.DlaScale)
	}
}

// firstPDFPageWidth returns the first page's width from a map of
// per-page PDF-point widths. The map is guaranteed to store values
// already converted to PDF-point space by processPage.
func firstPDFPageWidth(pageWidths map[int]float64) float64 {
	if len(pageWidths) == 0 {
		return 0
	}
	pages := make([]int, 0, len(pageWidths))
	for pg := range pageWidths {
		pages = append(pages, pg)
	}
	sort.Ints(pages)
	pg := pages[0]
	return pageWidths[pg]
}

func normalizePDFPositions(raw any) [][]any {
	positions, ok := raw.([][]any)
	if !ok || len(positions) == 0 {
		return nil
	}
	normalized := make([][]any, 0, len(positions))
	for _, pos := range positions {
		if len(pos) < 5 {
			continue
		}
		pageNumber, ok := normalizePDFPageNumber(pos[0])
		if !ok {
			continue
		}
		left, lok := numericAny(pos[1])
		right, rok := numericAny(pos[2])
		top, tok := numericAny(pos[3])
		bottom, bok := numericAny(pos[4])
		if !lok || !rok || !tok || !bok {
			continue
		}
		normalized = append(normalized, []any{pageNumber, left, right, top, bottom})
	}
	return normalized
}

// normalizePDFPageNumber converts a DeepDoc 0-indexed page number to the
// 1-indexed form stored in _pdf_positions / positions. It is the SINGLE
// 0→1 conversion point: DeepDoc (pdf_oxide/pdfium) emits 0-indexed pages,
// and every downstream consumer (AddPositions for ES storage,
// PositionsFromMatrix for the PDFium render path) expects 1-indexed input.
// Adding +1 unconditionally — instead of only for v<=0 — keeps all pages
// consistent; the old heuristic left page>=1 unconverted, which AddPositions
// then double-incremented and PositionsFromMatrix mis-decremented.
func normalizePDFPageNumber(raw any) (int, bool) {
	switch v := raw.(type) {
	case int:
		return v + 1, true
	case int64:
		return normalizePDFPageNumber(int(v))
	case float64:
		return normalizePDFPageNumber(int(v))
	case []any:
		if len(v) == 0 {
			return 0, false
		}
		return normalizePDFPageNumber(v[len(v)-1])
	case []int:
		if len(v) == 0 {
			return 0, false
		}
		return normalizePDFPageNumber(v[len(v)-1])
	default:
		return 0, false
	}
}

func numericAny(raw any) (float64, bool) {
	switch v := raw.(type) {
	case int:
		return float64(v), true
	case int64:
		return float64(v), true
	case float64:
		return v, true
	default:
		return 0, false
	}
}

func normalizePDFDocType(item map[string]any) {
	if item == nil {
		return
	}
	if docType, _ := item["doc_type_kwd"].(string); docType != "" {
		return
	}
	layoutType, _ := item["layout_type"].(string)
	switch layoutType {
	case "table":
		item["doc_type_kwd"] = "table"
	case "figure", "image":
		item["doc_type_kwd"] = "image"
	default:
		if img, _ := item["image"].(string); img != "" {
			item["doc_type_kwd"] = "image"
			return
		}
		item["doc_type_kwd"] = "text"
	}
}

func parsePDFWithDeepDoc(ctx context.Context, filename string, data []byte, parseFn func(context.Context, []byte, deepdoctype.DocAnalyzer) (*deepdoctype.ParseResult, error)) ParseResult {
	return parsePDFWithDeepDocOptions(ctx, filename, data, pdfPostProcessOptions{}, parseFn)
}

func parsePDFWithDeepDocOptions(ctx context.Context, filename string, data []byte, opts pdfPostProcessOptions, parseFn func(context.Context, []byte, deepdoctype.DocAnalyzer) (*deepdoctype.ParseResult, error)) ParseResult {
	if len(data) == 0 {
		return emptyPDFResult(filename)
	}
	parsed, err := parseFn(ctx, data, deepDocAnalyzerFromEnv())
	if err != nil {
		return ParseResult{Err: err}
	}
	var res ParseResult
	switch strings.ToLower(strings.TrimSpace(opts.outputFormat)) {
	case "", "json":
		res = pdfParseResultToJSONWithOptions(filename, parsed, opts)
	case "markdown":
		res = pdfParseResultToMarkdownWithOptions(filename, parsed, opts)
	default:
		return ParseResult{Err: fmt.Errorf("parser: unsupported PDF output_format %q", opts.outputFormat)}
	}
	for i := range res.JSON {
		if img, _ := res.JSON[i]["image"].(string); img != "" {
			res.JSON[i]["image"] = inlinePNGDataURL(img)
		}
	}
	return res
}
