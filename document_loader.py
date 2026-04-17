"""Utilities for extracting text from uploaded source files."""

from __future__ import annotations

from io import BytesIO

from docx import Document
from pypdf import PdfReader


SUPPORTED_EXTENSIONS = (".pdf", ".docx", ".txt")


def truncate_text(content: str, limit: int = 12000) -> str:
    """Keep uploaded content within a manageable prompt size."""
    cleaned = content.strip()
    if len(cleaned) <= limit:
        return cleaned
    return cleaned[:limit].rsplit(" ", 1)[0].strip()


def load_text_from_pdf(file_bytes: bytes) -> str:
    """Extract text from a PDF file."""
    reader = PdfReader(BytesIO(file_bytes))
    parts = []
    for page in reader.pages:
        parts.append(page.extract_text() or "")
    return "\n".join(part for part in parts if part.strip()).strip()


def load_text_from_docx(file_bytes: bytes) -> str:
    """Extract text from a DOCX file."""
    document = Document(BytesIO(file_bytes))
    paragraphs = [paragraph.text.strip() for paragraph in document.paragraphs if paragraph.text.strip()]
    return "\n".join(paragraphs).strip()


def load_text_from_txt(file_bytes: bytes) -> str:
    """Extract text from a plain text file."""
    return file_bytes.decode("utf-8", errors="ignore").strip()


def extract_text_from_uploaded_file(file_name: str, file_bytes: bytes) -> str:
    """Extract text based on the uploaded file extension."""
    lower_name = file_name.lower()
    if lower_name.endswith(".pdf"):
        content = load_text_from_pdf(file_bytes)
    elif lower_name.endswith(".docx"):
        content = load_text_from_docx(file_bytes)
    elif lower_name.endswith(".txt"):
        content = load_text_from_txt(file_bytes)
    else:
        raise ValueError("Unsupported file type. Upload a PDF, DOCX, or TXT file.")

    truncated = truncate_text(content)
    if not truncated:
        raise ValueError("The uploaded file does not contain readable text.")
    return truncated
