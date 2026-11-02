package component

import (
	"context"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"sync"

	"ragflow/internal/entity"
	modelModule "ragflow/internal/entity/models"
	"ragflow/internal/ingestion/component/schema"
	"ragflow/internal/utility"

	"gorm.io/gorm"
)

type pdfVisionPage struct {
	PageNumber int
	WidthPts   float64
	HeightPts  float64
	ImageURL   string
}

var (
	pdfVisionPromptLoader  = loadPDFVisionPrompt
	pdfVisionPageRenderer  = defaultRenderPDFVisionPages
	pdfVisionModelResolver = defaultPDFVisionModelResolver
	pdfVisionChatInvoker   = defaultPDFVisionChatInvoker
)

var (
	pdfVisionPromptCache   = make(map[string]string)
	pdfVisionPromptCacheMu sync.RWMutex
	pdfVisionPromptsBase   string
	pdfVisionPromptsOnce   sync.Once
)

func maybeDispatchPDFVision(
	ctx context.Context,
	db *gorm.DB,
	fileType utility.FileType,
	filename string,
	binary []byte,
	inputs map[string]any,
	setups map[string]schema.ParserSetup,
) (parserDispatchResult, bool, error) {
	if fileType != utility.FileTypePDF {
		return parserDispatchResult{}, false, nil
	}
	setup, ok := setups["pdf"]
	if !ok {
		return parserDispatchResult{}, false, nil
	}

	modelID, useVision := resolvePDFVisionModelID(setup)
	if !useVision {
		return parserDispatchResult{}, false, nil
	}
	tenantID := getStringOr(inputs, "tenant_id", "")
	if tenantID == "" {
		return parserDispatchResult{}, true, fmt.Errorf(
			`parser: pdf parse_method %q requires tenant_id to resolve VLM model`, modelID)
	}
	res, err := dispatchPDFVision(ctx, db, filename, binary, tenantID, modelID, setup)
	if err != nil {
		return parserDispatchResult{}, true, err
	}
	return res, true, nil
}

func resolvePDFVisionModelID(setup schema.ParserSetup) (string, bool) {
	if setup == nil {
		return "", false
	}
	if raw, ok := setup["parse_method"].(string); ok {
		method := strings.TrimSpace(raw)
		if method != "" && !isNamedPDFParseMethod(method) {
			return method, true
		}
	}
	if raw, ok := setup["layout_recognizer"].(string); ok {
		method := strings.TrimSpace(raw)
		if method == "" || strings.EqualFold(method, "plain text") || strings.EqualFold(method, "plaintext") {
			return "", false
		}
		if !isNamedPDFParseMethod(method) {
			return method, true
		}
	}
	return "", false
}

// isNamedPDFParseMethod reports whether raw is a recognized named PDF
// parse method rather than a custom VLM model name. Its membership set
// mirrors the PDF whitelist enforced by (*ParserComponent).Check().
//
//	deepdoc, plain_text, paddleocr, somark
func isNamedPDFParseMethod(raw string) bool {
	method := strings.ToLower(strings.TrimSpace(raw))
	switch method {
	case "deepdoc", "plain_text", "paddleocr", "somark":
		return true
	}
	return false
}

func dispatchPDFVision(
	ctx context.Context,
	db *gorm.DB,
	filename string,
	binary []byte,
	tenantID string,
	modelID string,
	setup schema.ParserSetup,
) (parserDispatchResult, error) {
	renderedPages, err := pdfVisionPageRenderer(binary)
	if err != nil {
		return parserDispatchResult{}, fmt.Errorf("parser: pdf vision render: %w", err)
	}
	driver, resolvedModelName, apiConfig, err := pdfVisionModelResolver(ctx, db, tenantID, modelID)
	if err != nil {
		return parserDispatchResult{}, fmt.Errorf("parser: pdf vision model %q: %w", modelID, err)
	}
	promptTemplate, err := pdfVisionPromptLoader("vision_llm_describe_prompt")
	if err != nil {
		return parserDispatchResult{}, fmt.Errorf("parser: load vision prompt: %w", err)
	}

	items := make([]map[string]any, 0, len(renderedPages))
	markdownParts := make([]string, 0, len(renderedPages))
	for _, page := range renderedPages {
		prompt := renderPDFVisionPrompt(promptTemplate, page.PageNumber)
		resp, err := pdfVisionChatInvoker(ctx, driver, resolvedModelName, buildPDFVisionMessages(prompt, page.ImageURL), apiConfig)
		if err != nil {
			return parserDispatchResult{}, fmt.Errorf("parser: pdf vision page %d: %w", page.PageNumber, err)
		}
		text := extractPDFVisionAnswer(resp)
		positions := [][]any{{page.PageNumber, 0.0, page.WidthPts, 0.0, page.HeightPts}}
		items = append(items, map[string]any{
			"text":           text,
			"doc_type_kwd":   "text",
			"page_number":    page.PageNumber,
			"_pdf_positions": positions,
			"positions":      positions,
		})
		if text != "" {
			markdownParts = append(markdownParts, text)
		}
	}

	outputFormat := "json"
	if v, ok := setup["output_format"].(string); ok && strings.TrimSpace(v) != "" {
		outputFormat = strings.ToLower(strings.TrimSpace(v))
	}
	fileMeta := map[string]any{
		"name":         filename,
		"page_count":   len(renderedPages),
		"outline":      []map[string]any{},
		"parse_method": modelID,
	}
	switch outputFormat {
	case "json":
		return parserDispatchResult{
			OutputFormat: "json",
			File:         fileMeta,
			JSON:         items,
		}, nil
	case "markdown":
		return parserDispatchResult{
			OutputFormat: "markdown",
			File:         fileMeta,
			Markdown:     strings.TrimSpace(strings.Join(markdownParts, "\n\n")),
		}, nil
	default:
		return parserDispatchResult{}, fmt.Errorf("parser: unsupported PDF output_format %q for vision parse_method %q", outputFormat, modelID)
	}
}

func buildPDFVisionMessages(prompt string, imageURL string) []modelModule.Message {
	return []modelModule.Message{{
		Role: "user",
		Content: []interface{}{
			map[string]any{"type": "text", "text": prompt},
			map[string]any{"type": "image_url", "image_url": map[string]any{"url": imageURL}},
		},
	}}
}

func extractPDFVisionAnswer(resp *modelModule.ChatResponse) string {
	if resp == nil || resp.Answer == nil {
		return ""
	}
	return strings.TrimSpace(*resp.Answer)
}

func defaultPDFVisionModelResolver(
	ctx context.Context,
	db *gorm.DB,
	tenantID string,
	modelID string,
) (modelModule.ModelDriver, string, *modelModule.APIConfig, error) {
	if strings.TrimSpace(modelID) == "" {
		driver, modelName, apiConfig, _, err := resolveTenantModelByType(ctx, db, tenantID, entity.ModelTypeImage2Text)
		return driver, modelName, apiConfig, err
	}
	driver, modelName, apiConfig, _, err := resolveModelConfig(ctx, db, tenantID, entity.ModelTypeImage2Text, modelID)
	return driver, modelName, apiConfig, err
}

func defaultPDFVisionChatInvoker(
	ctx context.Context,
	driver modelModule.ModelDriver,
	modelName string,
	messages []modelModule.Message,
	apiConfig *modelModule.APIConfig,
) (*modelModule.ChatResponse, error) {
	vision := true
	return driver.ChatWithMessages(ctx, modelName, messages, apiConfig, &modelModule.ChatConfig{Vision: &vision}, nil)
}

func loadPDFVisionPrompt(name string) (string, error) {
	pdfVisionPromptCacheMu.RLock()
	if cached, ok := pdfVisionPromptCache[name]; ok {
		pdfVisionPromptCacheMu.RUnlock()
		return cached, nil
	}
	pdfVisionPromptCacheMu.RUnlock()

	baseDir, err := pdfVisionPromptsBaseDir()
	if err != nil {
		return "", err
	}
	promptPath := filepath.Join(baseDir, "rag", "prompts", fmt.Sprintf("%s.md", name))
	content, err := os.ReadFile(promptPath)
	if err != nil {
		return "", fmt.Errorf("prompt file %q not found: %w", name, err)
	}
	cached := strings.TrimSpace(string(content))
	pdfVisionPromptCacheMu.Lock()
	pdfVisionPromptCache[name] = cached
	pdfVisionPromptCacheMu.Unlock()
	return cached, nil
}

func pdfVisionPromptsBaseDir() (string, error) {
	var initErr error
	pdfVisionPromptsOnce.Do(func() {
		root := utility.GetProjectRoot()
		if _, statErr := os.Stat(filepath.Join(root, "rag", "prompts")); statErr == nil {
			pdfVisionPromptsBase = root
			return
		}
		initErr = fmt.Errorf("rag/prompts not found under project root %q", root)
	})
	if initErr != nil {
		return "", initErr
	}
	return pdfVisionPromptsBase, nil
}

// renderPDFVisionPrompt only renders page metadata. The full-page PDF vision
// prompt is a transcription contract that preserves the document's original
// language; dataset-language instructions apply to figure descriptions in
// maybeDispatchPDFVisionEnhancement instead.
func renderPDFVisionPrompt(template string, page int) string {
	rendered := strings.ReplaceAll(template, "{{ page }}", fmt.Sprintf("%d", page))
	rendered = strings.ReplaceAll(rendered, "{{page}}", fmt.Sprintf("%d", page))
	return rendered
}

// maybeDispatchPDFVisionEnhancement mirrors Python's
// enhance_media_sections_with_vision for PDF
// After the normal PDF parser produces JSON items, this function
// enriches image/table items by calling the tenant's IMAGE2TEXT
// model and appending vision descriptions to each item's text field.
// The markdown/text output paths are not enhanced (Python does the same).
//
// This follows the exact same convention as maybeDispatchDOCXVision and
// maybeDispatchMarkdownVision: it is not gated by a separate setup flag,
// it simply resolves the tenant's IMAGE2TEXT model and skips silently
// when none is configured — matching Python's try/except pass behaviour.
func maybeDispatchPDFVisionEnhancement(
	ctx context.Context,
	db *gorm.DB,
	fileType utility.FileType,
	dispatched parserDispatchResult,
	inputs map[string]any,
) (parserDispatchResult, bool, error) {
	if fileType != utility.FileTypePDF {
		return dispatched, false, nil
	}
	if dispatched.Err != nil || dispatched.OutputFormat != "json" || len(dispatched.JSON) == 0 {
		return dispatched, false, nil
	}
	tenantID := getStringOr(inputs, "tenant_id", "")
	if tenantID == "" {
		return dispatched, false, nil
	}
	language := resolveVisionLanguage(inputs, "")
	driver, modelName, apiConfig, _, err := resolveTenantModelByType(ctx, db, tenantID, entity.ModelTypeImage2Text)
	if err != nil {
		return dispatched, false, nil
	}
	type target struct{ idx int }
	var targets []target
	for i, item := range dispatched.JSON {
		kd, _ := item["doc_type_kwd"].(string)
		if kd != "image" && kd != "table" {
			continue
		}
		img, _ := item["image"].(string)
		if img == "" {
			continue
		}
		targets = append(targets, target{idx: i})
	}
	if len(targets) == 0 {
		return dispatched, false, nil
	}
	descriptions := make([]string, len(targets))
	var wg sync.WaitGroup
	sem := make(chan struct{}, pdfVisionEnhanceConcurrency)
	for slot, tg := range targets {
		sem <- struct{}{}
		wg.Add(1)
		go func(slot int, itemIdx int) {
			defer wg.Done()
			defer func() { <-sem }()
			img, _ := dispatched.JSON[itemIdx]["image"].(string)
			if img == "" {
				return
			}
			prompt, perr := figureVisionPromptBuilder("", "", language)
			if perr != nil {
				return
			}
			messages := buildVisionMessages(prompt, img)
			resp, ierr := visionChatInvoker(ctx, driver, modelName, messages, apiConfig)
			if ierr != nil {
				return
			}
			descriptions[slot] = extractDOCXVisionAnswer(resp)
		}(slot, tg.idx)
	}
	wg.Wait()
	modified := false
	for slot, tg := range targets {
		desc := strings.TrimSpace(descriptions[slot])
		if desc == "" {
			continue
		}
		existing, _ := dispatched.JSON[tg.idx]["text"].(string)
		if existing != "" {
			dispatched.JSON[tg.idx]["text"] = existing + "\n" + desc
		} else {
			dispatched.JSON[tg.idx]["text"] = desc
		}
		modified = true
	}
	return dispatched, modified, nil
}

var pdfVisionEnhanceConcurrency = 10
