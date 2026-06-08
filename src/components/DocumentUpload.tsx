import { useState, useRef } from "react";
import { Upload, FileText, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface DocumentUploadProps {
  onExtracted: (text: string) => void;
  className?: string;
}

/**
 * Document Upload — PRD Section 8, Step 1, Option B (Phase 2+)
 * Supports PDF and plain text extraction for context ingestion.
 * Uses browser-native FileReader for text files.
 * For PDFs, extracts text content via a lightweight approach.
 */
export function DocumentUpload({ onExtracted, className }: DocumentUploadProps) {
  const [file, setFile] = useState<File | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0];
    if (!selected) return;

    setFile(selected);
    setError(null);
    setExtracting(true);

    try {
      const text = await extractText(selected);
      if (text.trim().length < 10) {
        (window as any).pendo?.track("document_upload_failed", {
          fileType: selected.name.split(".").pop()?.toLowerCase() || "unknown",
          fileSize: selected.size,
          fileName: selected.name,
          errorMessage: "Could not extract meaningful text from this file.",
        });
        setError("Could not extract meaningful text from this file.");
        setExtracting(false);
        return;
      }

      (window as any).pendo?.track("document_uploaded", {
        fileType: selected.name.split(".").pop()?.toLowerCase() || "unknown",
        fileSize: selected.size,
        extractedTextLength: text.length,
        fileName: selected.name,
      });

      onExtracted(text);
    } catch (err) {
      (window as any).pendo?.track("document_upload_failed", {
        fileType: selected.name.split(".").pop()?.toLowerCase() || "unknown",
        fileSize: selected.size,
        fileName: selected.name,
        errorMessage: "Failed to read file.",
      });
      setError("Failed to read file. Try a .txt or .md file instead.");
    } finally {
      setExtracting(false);
    }
  };

  const handleRemove = () => {
    setFile(null);
    setError(null);
    if (inputRef.current) inputRef.current.value = "";
  };

  return (
    <div className={cn("space-y-2", className)}>
      {!file ? (
        <label
          className="flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border bg-card/30 p-5 transition-colors hover:border-primary/40"
        >
          <Upload className="h-5 w-5 text-muted-foreground" />
          <p className="text-[13px] text-muted-foreground">
            Drop a deck, resume, or PRD <span className="text-muted-foreground/50">(PDF, TXT, MD)</span>
          </p>
          <p className="font-mono text-[10px] text-muted-foreground/50">
            Your opponent will challenge the exact claims inside it
          </p>
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.txt,.md,.docx"
            onChange={handleFileSelect}
            className="hidden"
          />
        </label>
      ) : (
        <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-3">
          <FileText className="w-5 h-5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium truncate">{file.name}</p>
            <p className="text-xs text-muted-foreground">
              {extracting ? "Extracting text..." : `${(file.size / 1024).toFixed(1)} KB`}
            </p>
          </div>
          {extracting ? (
            <Loader2 className="w-4 h-4 animate-spin text-primary" />
          ) : (
            <button
              onClick={handleRemove}
              className="p-1 text-muted-foreground hover:text-destructive transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          )}
        </div>
      )}
      {error && <p className="text-xs text-destructive">{error}</p>}
    </div>
  );
}

// --- Text Extraction ---

async function extractText(file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase();

  if (ext === "txt" || ext === "md") {
    return file.text();
  }

  if (ext === "pdf") {
    return extractPdfText(file);
  }

  if (ext === "docx") {
    return extractDocxText(file);
  }

  // Fallback: try to read as text
  return file.text();
}

/**
 * Basic PDF text extraction — reads raw bytes and extracts text streams.
 * Not perfect, but works for most text-heavy PDFs without external libs.
 */
async function extractPdfText(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const text = new TextDecoder("utf-8", { fatal: false }).decode(bytes);

  // Extract text between BT and ET markers (PDF text objects)
  const textBlocks: string[] = [];
  const btPattern = /BT\s([\s\S]*?)ET/g;
  let match;
  while ((match = btPattern.exec(text)) !== null) {
    const block = match[1];
    // Extract text within parentheses (PDF string literals)
    const strPattern = /\(([^)]*)\)/g;
    let strMatch;
    while ((strMatch = strPattern.exec(block)) !== null) {
      const decoded = strMatch[1]
        .replace(/\\n/g, "\n")
        .replace(/\\r/g, "")
        .replace(/\\\(/g, "(")
        .replace(/\\\)/g, ")")
        .replace(/\\\\/g, "\\");
      if (decoded.trim()) textBlocks.push(decoded);
    }
  }

  if (textBlocks.length === 0) {
    // Fallback: just extract anything that looks like readable text
    const readable = text.replace(/[^\x20-\x7E\n\r]/g, " ").replace(/\s{3,}/g, "\n");
    return readable.slice(0, 5000);
  }

  return textBlocks.join(" ").slice(0, 5000);
}

/**
 * Basic DOCX text extraction — reads the XML content.
 * DOCX is a zip file containing XML. We extract paragraph text.
 */
async function extractDocxText(file: File): Promise<string> {
  // DOCX is actually a zip. We can't easily unzip in the browser without a lib,
  // so we do a basic binary scan for text content.
  const buffer = await file.arrayBuffer();
  const text = new TextDecoder("utf-8", { fatal: false }).decode(new Uint8Array(buffer));

  // Extract text between <w:t> tags (Word XML text runs)
  const textBlocks: string[] = [];
  const pattern = /<w:t[^>]*>([^<]+)<\/w:t>/g;
  let match;
  while ((match = pattern.exec(text)) !== null) {
    textBlocks.push(match[1]);
  }

  if (textBlocks.length > 0) {
    return textBlocks.join(" ").slice(0, 5000);
  }

  // Fallback
  return text.replace(/[^\x20-\x7E\n\r]/g, " ").replace(/\s{3,}/g, " ").trim().slice(0, 5000);
}
