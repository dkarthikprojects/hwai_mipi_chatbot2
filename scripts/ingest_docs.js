// scripts/ingest_docs.js
// ─────────────────────────────────────────────────────────────────────────────
// MIPI POWER HOUSE — Document Ingestion Pipeline
//
// Reads EOC and Dental PDFs from Supabase Storage (or local scripts/docs/),
// extracts text, chunks it intelligently, embeds each chunk with OpenAI,
// and stores in the document_chunks table for vector search.
//
// USAGE:
//   node scripts/ingest_docs.js              → ingest all new/pending docs
//   node scripts/ingest_docs.js --file x.pdf → ingest one specific file
//   node scripts/ingest_docs.js --reingest   → re-process already ingested docs
//   node scripts/ingest_docs.js --stats      → show ingestion status
//
// PREREQUISITES:
//   npm install @supabase/supabase-js openai pdf-parse dotenv
//
// PDF PLACEMENT:
//   Option A (recommended): Upload PDFs to Supabase Storage bucket "plan-documents"
//     via Supabase Dashboard → Storage → plan-documents → Upload
//   Option B (local): Place PDFs in scripts/docs/ and they will be auto-uploaded
//
// PDF NAMING CONVENTION (important for metadata extraction):
//   {ParentOrg}_{PlanName}_{DocType}_{Year}.pdf
//   e.g. Humana_GoldPlus_EOC_2026.pdf
//        Aetna_DSNP_Dental_2026.pdf
//   Or use the metadata override file (scripts/docs/metadata.json) for full control.
// ─────────────────────────────────────────────────────────────────────────────

import { createClient }      from "@supabase/supabase-js";
import OpenAI                from "openai";
import pdfParse              from "pdf-parse";
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, basename, dirname } from "path";
import { fileURLToPath }     from "url";
import "dotenv/config";

const __dirname = dirname(fileURLToPath(import.meta.url));
const DOCS_DIR  = join(__dirname, "docs");

// ── Config ────────────────────────────────────────────────────────────────────
const CHUNK_SIZE    = 800;  // characters per chunk (optimal for embedding + GPT-4o context)
const CHUNK_OVERLAP = 150;  // overlap between adjacent chunks for context continuity
const EMBED_MODEL   = "text-embedding-3-small"; // 1536-dim, fast, cost-effective
const EMBED_BATCH   = 20;   // chunks to embed in one API call (OpenAI limit: 100)

// ── Clients ───────────────────────────────────────────────────────────────────
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY,
  { auth: { persistSession: false } }
);
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ── Metadata extraction from filename ────────────────────────────────────────
function extractMetaFromFilename(filename) {
  // Try to load override from metadata.json first
  const metaPath = join(DOCS_DIR, "metadata.json");
  if (existsSync(metaPath)) {
    const allMeta = JSON.parse(readFileSync(metaPath, "utf8"));
    if (allMeta[filename]) return allMeta[filename];
  }

  // Parse from filename convention: OrgName_PlanName_DocType_Year.pdf
  const base  = basename(filename, ".pdf");
  const parts = base.split("_");
  const docTypePart = parts.find(function(p) {
    return ["eoc","dental","evidence","Evidence"].includes(p.toLowerCase());
  });
  const yearPart = parts.find(function(p) { return /^20\d{2}$/.test(p); });

  return {
    doc_name:   filename,
    doc_type:   docTypePart
      ? (docTypePart.toLowerCase().startsWith("e") ? "eoc" : "dental")
      : "eoc",
    parent_org: parts[0] || "Unknown",
    plan_name:  parts.slice(1, -2).join(" ") || null,
    plan_year:  yearPart ? parseInt(yearPart) : 2026,
  };
}

// ── Text extraction from PDF ──────────────────────────────────────────────────
async function extractPdfText(pdfBuffer) {
  const result = await pdfParse(pdfBuffer);
  return {
    text:      result.text,
    pageCount: result.numpages,
    // pdf-parse gives us full text — we split by page markers below
    pages:     result.text.split(/\f/).filter(function(p) {
      return p.trim().length > 0;
    }),
  };
}

// ── Section detection ─────────────────────────────────────────────────────────
// Recognises common EOC/Dental section headings for better citation quality
const SECTION_PATTERNS = [
  { re: /benefits?\s+at\s+a\s+glance/i,          label: "Benefits at a Glance" },
  { re: /what\s+is\s+covered/i,                  label: "Covered Services" },
  { re: /what\s+is\s+not\s+covered/i,            label: "Exclusions" },
  { re: /exclusions?\s+and\s+limitations?/i,     label: "Exclusions & Limitations" },
  { re: /prior\s+authoriz/i,                     label: "Prior Authorization" },
  { re: /emergency\s+(services?|care)/i,         label: "Emergency Services" },
  { re: /dental\s+(benefits?|coverage)/i,        label: "Dental Benefits" },
  { re: /annual\s+maximum/i,                     label: "Annual Maximum" },
  { re: /orthodonti/i,                           label: "Orthodontic Services" },
  { re: /waiting\s+period/i,                     label: "Waiting Periods" },
  { re: /out.of.pocket/i,                        label: "Out-of-Pocket Costs" },
  { re: /cost.sharing/i,                         label: "Cost Sharing" },
  { re: /deductible/i,                           label: "Deductibles" },
  { re: /grievance|appeal/i,                     label: "Grievances & Appeals" },
  { re: /prescription\s+drug/i,                  label: "Prescription Drugs" },
];

function detectSection(text) {
  for (const p of SECTION_PATTERNS) {
    const match = text.match(p.re);
    if (match) return p.label;
  }
  return null;
}

// ── Smart chunking ────────────────────────────────────────────────────────────
// Chunks by character size with overlap, tracking page and section.
function chunkDocument(pages, meta) {
  const chunks    = [];
  let   chunkIdx  = 0;
  let   curSection = "General";

  pages.forEach(function(pageText, pageNum) {
    // Detect section from page start
    const firstLines = pageText.slice(0, 400);
    const detected   = detectSection(firstLines);
    if (detected) curSection = detected;

    // Slide a window across the page text
    let pos = 0;
    while (pos < pageText.length) {
      const end  = Math.min(pos + CHUNK_SIZE, pageText.length);
      let   text = pageText.slice(pos, end).trim();

      // Snap to word boundary
      if (end < pageText.length) {
        const lastSpace = text.lastIndexOf(" ");
        if (lastSpace > CHUNK_SIZE * 0.7) text = text.slice(0, lastSpace);
      }

      if (text.length > 60) { // skip very short fragments
        // Re-detect section within this chunk
        const localSection = detectSection(text) || curSection;

        chunks.push({
          doc_name:    meta.doc_name,
          doc_type:    meta.doc_type,
          plan_name:   meta.plan_name   || null,
          parent_org:  meta.parent_org  || null,
          state_code:  meta.state_code  || null,
          plan_year:   meta.plan_year   || 2026,
          page_number: pageNum + 1,
          section:     localSection,
          chunk_index: chunkIdx++,
          chunk_text:  text,
          char_count:  text.length,
        });
      }
      pos += CHUNK_SIZE - CHUNK_OVERLAP;
    }
  });

  return chunks;
}

// ── Embed chunks in batches ───────────────────────────────────────────────────
async function embedChunks(chunks) {
  const embedded = [];
  for (let i = 0; i < chunks.length; i += EMBED_BATCH) {
    const batch  = chunks.slice(i, i + EMBED_BATCH);
    const texts  = batch.map(function(c) { return c.chunk_text; });
    const res    = await openai.embeddings.create({
      model: EMBED_MODEL,
      input: texts,
    });
    res.data.forEach(function(item, j) {
      embedded.push(Object.assign({}, batch[j], {
        embedding: "[" + item.embedding.join(",") + "]",
      }));
    });
    process.stdout.write(
      "  Embedded " + Math.min(i+EMBED_BATCH,chunks.length)
      + "/" + chunks.length + " chunks\r"
    );
  }
  console.log();
  return embedded;
}

// ── Upsert chunks to Supabase ─────────────────────────────────────────────────
async function upsertChunks(chunks, documentId) {
  const rows = chunks.map(function(c) {
    return Object.assign({ document_id: documentId }, c);
  });
  const BATCH = 100;
  let   saved = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const { error } = await supabase
      .from("document_chunks")
      .insert(rows.slice(i, i + BATCH));
    if (error) throw new Error("Upsert failed: " + error.message);
    saved += Math.min(BATCH, rows.length - i);
  }
  return saved;
}

// ── Ingest one PDF ────────────────────────────────────────────────────────────
async function ingestDocument(pdfBuffer, filename, overrideMeta) {
  const meta = Object.assign(
    extractMetaFromFilename(filename), overrideMeta || {}
  );
  console.log("\n[" + meta.doc_type.toUpperCase() + "] " + meta.doc_name);
  console.log("  Org:", meta.parent_org, "| Plan:", meta.plan_name||"N/A");

  // Upsert document record
  const { data: docRow, error: docErr } = await supabase
    .from("documents")
    .upsert({
      doc_name:     meta.doc_name,
      doc_type:     meta.doc_type,
      plan_name:    meta.plan_name  || null,
      parent_org:   meta.parent_org || null,
      state_code:   meta.state_code || null,
      plan_year:    meta.plan_year  || 2026,
      storage_path: "plan-documents/" + filename,
      status:       "ingesting",
    }, { onConflict: "doc_name" })
    .select("id")
    .single();

  if (docErr) throw new Error("Doc record failed: " + docErr.message);
  const documentId = docRow.id;

  // Extract text
  console.log("  Extracting text...");
  const { text, pageCount, pages } = await extractPdfText(pdfBuffer);
  console.log("  Pages:", pageCount, "| Chars:", text.length.toLocaleString());

  // Delete existing chunks for this doc (clean re-ingest)
  await supabase.from("document_chunks").delete().eq("document_id", documentId);

  // Chunk
  const chunks = chunkDocument(pages, meta);
  console.log("  Chunks:", chunks.length);

  // Embed
  console.log("  Embedding...");
  const embedded = await embedChunks(chunks);

  // Save
  console.log("  Saving to Supabase...");
  const saved = await upsertChunks(embedded, documentId);

  // Mark as ingested
  await supabase.from("documents").update({
    status:      "ingested",
    page_count:  pageCount,
    chunk_count: saved,
    ingested_at: new Date().toISOString(),
    error_msg:   null,
  }).eq("id", documentId);

  console.log("  Done: " + saved + " chunks saved");
  return { doc_name: meta.doc_name, chunks: saved };
}

// ── Download PDF from Supabase Storage ───────────────────────────────────────
async function downloadFromStorage(filename) {
  const { data, error } = await supabase.storage
    .from("plan-documents")
    .download(filename);
  if (error) throw new Error("Storage download failed: " + error.message);
  const arrayBuffer = await data.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── List PDFs in Storage ──────────────────────────────────────────────────────
async function listStoragePdfs() {
  const { data, error } = await supabase.storage
    .from("plan-documents")
    .list("", { limit: 100 });
  if (error) throw new Error("Storage list failed: " + error.message);
  return (data || [])
    .filter(function(f) { return f.name.endsWith(".pdf"); })
    .map(function(f) { return f.name; });
}

// ── Show stats ────────────────────────────────────────────────────────────────
async function showStats() {
  const { data: docs } = await supabase
    .from("documents").select("*").order("created_at");
  if (!docs || docs.length === 0) {
    console.log("No documents ingested yet.");
    return;
  }
  console.log("\n── Document Ingestion Status ──────────────────");
  docs.forEach(function(d) {
    const tick = d.status === "ingested" ? "✅" : d.status === "error" ? "❌" : "⏳";
    console.log(
      tick, "[" + d.doc_type.toUpperCase() + "]",
      d.doc_name.padEnd(50),
      "chunks:", String(d.chunk_count||0).padStart(4),
      "| status:", d.status
    );
    if (d.error_msg) console.log("   Error:", d.error_msg);
  });
  console.log("──────────────────────────────────────────────");
  const ingested = docs.filter(function(d){return d.status==="ingested";});
  console.log(
    "Total:", docs.length, "| Ingested:", ingested.length,
    "| Pending:", docs.filter(function(d){return d.status==="pending";}).length
  );
}

// ── Main ──────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);

if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
  console.error("Error: SUPABASE_URL and SUPABASE_SERVICE_KEY required in .env.local");
  process.exit(1);
}
if (!process.env.OPENAI_API_KEY) {
  console.error("Error: OPENAI_API_KEY required in .env.local");
  process.exit(1);
}

if (args.includes("--stats")) {
  await showStats();
  process.exit(0);
}

const singleFile = args[args.indexOf("--file") + 1];
const reingest   = args.includes("--reingest");

console.log("\n MIPI POWER HOUSE — Document Ingestion Pipeline");
console.log("================================================");
console.log("Connecting to Supabase Storage bucket: plan-documents\n");

let results = [];

if (singleFile) {
  // Ingest one specific file from Storage
  console.log("Ingesting single file:", singleFile);
  const buf = await downloadFromStorage(singleFile);
  results.push(await ingestDocument(buf, singleFile));
} else {
  // List all PDFs in Storage
  const files = await listStoragePdfs();
  console.log("Found", files.length, "PDF(s) in Supabase Storage");

  if (files.length === 0) {
    console.log(
      "\nNo PDFs found. Upload PDFs to Supabase Dashboard → Storage → plan-documents"
    );
    process.exit(0);
  }

  // Filter to new/pending unless --reingest flag
  let toProcess = files;
  if (!reingest) {
    const { data: existing } = await supabase
      .from("documents")
      .select("doc_name, status")
      .eq("status", "ingested");
    const done = new Set((existing||[]).map(function(d){return d.doc_name;}));
    toProcess = files.filter(function(f){ return !done.has(f); });
    console.log(
      "New/pending:", toProcess.length,
      "| Already ingested:", files.length - toProcess.length
    );
  }

  for (const filename of toProcess) {
    try {
      const buf = await downloadFromStorage(filename);
      results.push(await ingestDocument(buf, filename));
    } catch(e) {
      console.error("  FAILED:", filename, "—", e.message);
      await supabase.from("documents").upsert({
        doc_name:  filename,
        doc_type:  "eoc",
        status:    "error",
        error_msg: e.message,
      }, { onConflict: "doc_name" });
    }
  }
}

console.log("\n── Ingestion complete ───────────────────────────");
console.log("Processed:", results.length, "document(s)");
results.forEach(function(r) {
  console.log(" ", r.doc_name, "→", r.chunks, "chunks");
});
console.log("\nRun `node scripts/ingest_docs.js --stats` to verify.");
