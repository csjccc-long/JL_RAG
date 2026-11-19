"""Turn an uploaded file into memories.

A memory system that only accepts chat turns is a chat feature. The same bank is
far more useful when a contract, a runbook or a screenshot can be added to it,
because those are exactly the things a person does not retype into a prompt.

Extraction is best-effort and dependency-light: whichever parser is installed is
used, and a missing one is a clear error the caller can act on rather than an
import failure at startup. Scanned pages and images go through the tenant's
vision model, so OCR costs the same quota as any other model call and needs no
extra service.
"""

from __future__ import annotations

import io
import re
from pathlib import PurePath

from memory.hindsight.chunking import CHUNK_CHARS, chunk_text  # noqa: F401 - re-exported for callers
from memory.hindsight.llm import Providers

MAX_CHARS = 400_000
OCR_MIN_CHARS = 40
_MIME = {
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".bmp": "image/bmp",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}
_TEXT_EXT = {".txt", ".md", ".markdown", ".csv", ".json", ".yaml", ".yml", ".log", ".srt", ".ini", ".conf"}
_OCR_PROMPT = (
    "Transcribe every piece of text in this image exactly as it appears. "
    "Keep line breaks and tables readable. Output text only."
)


class IngestError(ValueError):
    """Unsupported or unreadable upload; the message is shown to the user."""


def suffix(filename: str) -> str:
    return PurePath(filename or "").suffix.lower()


def supported(filename: str) -> bool:
    ext = suffix(filename)
    return ext in _TEXT_EXT or ext in _MIME or ext in {".pdf", ".docx", ".xlsx", ".pptx", ".html", ".htm"}


def _decode(data: bytes) -> str:
    for encoding in ("utf-8", "utf-16", "gb18030", "latin-1"):
        try:
            return data.decode(encoding)
        except (UnicodeDecodeError, LookupError):
            continue
    return data.decode("utf-8", errors="replace")


def _pdf(data: bytes) -> str:
    try:
        import fitz  # PyMuPDF
    except ImportError:
        fitz = None
    if fitz is not None:
        with fitz.open(stream=data, filetype="pdf") as doc:
            return "\n\n".join(page.get_text("text") for page in doc)
    try:
        from PyPDF2 import PdfReader
    except ImportError as exc:
        raise IngestError("PDF support needs PyMuPDF or PyPDF2 installed") from exc
    reader = PdfReader(io.BytesIO(data))
    return "\n\n".join((page.extract_text() or "") for page in reader.pages)


def _docx(data: bytes) -> str:
    try:
        import docx
    except ImportError as exc:
        raise IngestError("DOCX support needs python-docx installed") from exc
    document = docx.Document(io.BytesIO(data))
    parts = [paragraph.text for paragraph in document.paragraphs if paragraph.text.strip()]
    for table in document.tables:
        for row in table.rows:
            cells = [cell.text.strip() for cell in row.cells if cell.text.strip()]
            if cells:
                parts.append(" | ".join(cells))
    return "\n".join(parts)


def _xlsx(data: bytes) -> str:
    try:
        import openpyxl
    except ImportError as exc:
        raise IngestError("XLSX support needs openpyxl installed") from exc
    book = openpyxl.load_workbook(io.BytesIO(data), read_only=True, data_only=True)
    parts: list[str] = []
    for sheet in book.worksheets:
        parts.append(f"## {sheet.title}")
        for row in sheet.iter_rows(values_only=True):
            cells = [str(cell) for cell in row if cell not in (None, "")]
            if cells:
                parts.append(" | ".join(cells))
    book.close()
    return "\n".join(parts)


def _pptx(data: bytes) -> str:
    try:
        from pptx import Presentation
    except ImportError as exc:
        raise IngestError("PPTX support needs python-pptx installed") from exc
    deck = Presentation(io.BytesIO(data))
    parts: list[str] = []
    for index, slide in enumerate(deck.slides, start=1):
        parts.append(f"## Slide {index}")
        for shape in slide.shapes:
            text = getattr(shape, "text", "")
            if text and text.strip():
                parts.append(text.strip())
    return "\n".join(parts)


def _html(data: bytes) -> str:
    raw = _decode(data)
    try:
        from bs4 import BeautifulSoup
    except ImportError:
        return re.sub(r"<[^>]+>", " ", raw)
    soup = BeautifulSoup(raw, "lxml")
    for tag in soup(["script", "style", "noscript"]):
        tag.decompose()
    return soup.get_text("\n")


def _to_png(data: bytes) -> bytes:
    try:
        from PIL import Image
    except ImportError:
        return data
    try:
        with Image.open(io.BytesIO(data)) as image:
            buffer = io.BytesIO()
            image.convert("RGB").save(buffer, format="PNG")
            return buffer.getvalue()
    except Exception:  # noqa: BLE001 - an unreadable image is reported by the vision call
        return data


async def extract_text(data: bytes, filename: str, *, providers: Providers | None = None) -> str:
    """Best-effort text for one upload; raises IngestError when it cannot."""
    if not data:
        raise IngestError("empty upload")
    ext = suffix(filename)
    if ext in _TEXT_EXT:
        return _decode(data)[:MAX_CHARS]
    if ext in (".html", ".htm"):
        return _html(data)[:MAX_CHARS]
    if ext == ".pdf":
        text = _pdf(data)
        if len(text.strip()) < OCR_MIN_CHARS and providers is not None:
            text = await _ocr_pdf(data, providers)
        return text[:MAX_CHARS]
    if ext == ".docx":
        return _docx(data)[:MAX_CHARS]
    if ext == ".xlsx":
        return _xlsx(data)[:MAX_CHARS]
    if ext == ".pptx":
        return _pptx(data)[:MAX_CHARS]
    if ext in _MIME or ext in (".bmp", ".tif", ".tiff"):
        if providers is None:
            raise IngestError("image OCR needs a vision model")
        return (await providers.describe(_to_png(data), _OCR_PROMPT))[:MAX_CHARS]
    raise IngestError(f"unsupported file type: {ext or filename}")


async def _ocr_pdf(data: bytes, providers: Providers) -> str:
    try:
        import fitz
    except ImportError:
        return ""
    pages: list[str] = []
    with fitz.open(stream=data, filetype="pdf") as doc:
        for page in doc:
            pixmap = page.get_pixmap(dpi=200)
            pages.append(await providers.describe(pixmap.tobytes("png"), _OCR_PROMPT))
    return "\n\n".join(pages)
