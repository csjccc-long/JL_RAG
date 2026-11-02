---
sidebar_position: -3
title: Select PDF Parser
sidebar_label: Select PDF Parser
slug: /select_pdf_parser
sidebar_custom_props: {
  categoryIcon: LucideFileText
}
---
# Select PDF Parser

Select a PDF parsing backend for your dataset.

---

RAGFlow separates PDF parsing from chunking so that scanned documents and complex layouts can use OCR while plain-text PDFs can skip unnecessary vision work.

![data extraction](https://raw.githubusercontent.com/infiniflow/ragflow-docs/main/images/data_extraction.jpg)

## Prerequisites

- The PDF parser dropdown menu appears only when you select a chunking method compatible with PDFs, including:
  - **General**
  - **Manual**
  - **Paper**
  - **Book**
  - **Laws**
  - **Presentation**
  - **One**
- To use PaddleOCR or SoMark, configure the corresponding provider under **Model providers**. Environment variables can be used to auto-provision the provider on first use.

## Quickstart

1. On your dataset's **Configuration** page, select a chunking method, such as **General**.
2. Select one of the following PDF parsers:

- **DeepDoc** (default): RAGFlow's built-in OCR, table structure recognition, and document layout recognition pipeline.
- **PaddleOCR**: Remote OCR through an official PaddleOCR API or a self-hosted PaddleOCR service.
- **SoMark**: Layout-aware OCR through the SoMark API or a compatible deployment.
- **Naive**: Skip OCR and layout recognition when all PDFs contain clean, machine-readable text.

3. Save the configuration and parse the document.

:::tip NOTE
Use a vision parser when the PDF contains scanned pages, formulas, complex tables, or mixed layouts. Use **Naive** only when the PDF text can be extracted directly.
:::

## Frequently Asked Questions

### When should I select DeepDoc instead of an external OCR service?

DeepDoc runs with the RAGFlow deployment and is the default choice for local processing. PaddleOCR and SoMark are useful when you already operate one of those services or need their layout-aware output.

### Can I use these parsers for DOCX files?

No. The PDF parser dropdown applies to PDFs only. Convert DOCX files to PDF first if you need PDF-specific OCR or layout analysis.
