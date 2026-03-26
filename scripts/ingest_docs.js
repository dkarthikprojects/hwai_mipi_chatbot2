#!/usr/bin/env node
// scripts/ingest_docs.js — MIPI PDF Ingestion (CommonJS compatible)

const https    = require("https");
const http     = require("http");
const fs       = require("fs");
const path     = require("path");
const { createClient } = require("@supabase/supabase-js");

// ── Load .env.local ───────────────────────────────────────────────────────────
const envFile = path.join(__dirname, "../.env.local");
if (fs.existsSync(envFile)) {
  fs.readFileSync(envFile,"utf8").split("\n").forEach(line => {
    const m = line.match(/^([^#=\s][^=]*)=(.*)/);
    if (m) process.env[m[1].trim()] = m[2].trim();
  });
}

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const OPENAI_KEY   = process.env.OPENAI_API_KEY;
const BUCKET       = "pdfs";

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error("❌  Supabase credentials missing. Set environment variables:\n");
  console.error("   set SUPABASE_URL=https://dbyramegpnrsccdtqcqt.supabase.co");
  console.error("   set SUPABASE_SERVICE_KEY=eyJ...\n");
  process.exit(1);
}
if (!OPENAI_KEY) {
  console.error("❌  OPENAI_API_KEY missing.\n");
  process.exit(1);
}

const db = createClient(SUPABASE_URL, SUPABASE_KEY, { auth: { persistSession: false } });

// ── Load pdf-parse ────────────────────────────────────────────────────────────
var pdfParse = require("pdf-parse");

// ── PDF text extractor ───────────────────────────────────────────────────────
async function extractTextFromPdf(buffer) {
  try {
    var result = await pdfParse(buffer);
    var text   = result.text || "";
    // Strip XML/HTML tags that sometimes appear in PDF metadata streams
    text = text.replace(/<[^>]{1,200}>/g, " ");
    // Collapse whitespace
    text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
    return { text: text, pages: result.numpages };
  } catch (e) {
    // Fallback: manual BT/ET extraction for non-standard PDFs
    var content = buffer.toString("binary");
    var lines   = [];
    var re      = /\(([^)]{2,200})\)\s*Tj/g;
    var m;
    while ((m = re.exec(content)) !== null) {
      var t = m[1].trim();
      if (/[a-zA-Z]{2,}/.test(t)) lines.push(t);
    }
    var raw = lines.join(" ").replace(/[ \t]+/g, " ").trim();
    return { text: raw, pages: 0 };
  }
}

// ── Chunk text ────────────────────────────────────────────────────────────────
function chunkText(text, docName) {
  const CHUNK_SIZE    = 500;
  const CHUNK_OVERLAP = 80;
  const docType = docName.toLowerCase().includes("dental") ? "dental" : "eoc";
  const chunks  = [];
  let i = 0, idx = 0;
  while (i < text.length) {
    const chunk = text.slice(i, i + CHUNK_SIZE).trim();
    if (chunk.length > 30) {
      chunks.push({
        doc_name:    docName,
        doc_type:    docType,
        chunk_index: idx++,
        chunk_text:  chunk,
        page_number: Math.floor(i / 3000) + 1,
        section:     "General",
      });
    }
    i += CHUNK_SIZE - CHUNK_OVERLAP;
  }
  return chunks;
}

// ── Call OpenAI Embeddings API ────────────────────────────────────────────────
function callOpenAI(payload) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(payload);
    const req  = https.request({
      hostname: "api.openai.com",
      path:     "/v1/embeddings",
      method:   "POST",
      headers:  {
        "Content-Type":  "application/json",
        "Authorization": "Bearer " + OPENAI_KEY,
        "Content-Length": Buffer.byteLength(body),
      },
    }, res => {
      let data = "";
      res.on("data", d => { data += d; });
      res.on("end", () => {
        try { resolve(JSON.parse(data)); }
        catch(e) { reject(new Error("OpenAI parse error: " + data.slice(0,200))); }
      });
    });
    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

async function embedChunks(chunks) {
  const BATCH  = 20;
  const result = [];
  for (let i = 0; i < chunks.length; i += BATCH) {
    const batch  = chunks.slice(i, i + BATCH);
    const res    = await callOpenAI({
      model: "text-embedding-3-small",
      input: batch.map(c => c.chunk_text),
    });
    if (res.error) throw new Error("OpenAI: " + res.error.message);
    res.data.forEach((item, j) => {
      result.push({ ...batch[j], embedding: "[" + item.embedding.join(",") + "]" });
    });
    process.stdout.write(`   Embedding ${Math.min(i+BATCH,chunks.length)}/${chunks.length}\r`);
  }
  process.stdout.write("\n");
  return result;
}

// ── Save to Supabase ──────────────────────────────────────────────────────────
async function saveChunks(chunks) {
  await db.from("document_chunks").delete().eq("doc_name", chunks[0].doc_name);
  for (let i = 0; i < chunks.length; i += 50) {
    const { error } = await db.from("document_chunks").insert(chunks.slice(i, i + 50));
    if (error) throw new Error("DB insert: " + error.message);
  }
  return chunks.length;
}

// ── Download PDF from Supabase ────────────────────────────────────────────────
async function downloadPdf(filename) {
  const { data, error } = await db.storage.from(BUCKET).download(filename);
  if (error) throw new Error("Download failed: " + error.message);
  const ab = await data.arrayBuffer();
  return Buffer.from(ab);
}

// ── List PDFs ─────────────────────────────────────────────────────────────────
async function listPdfs() {
  const { data, error } = await db.storage.from(BUCKET).list("", { limit: 500 });
  if (error) { console.error("❌  Cannot access bucket:", error.message); process.exit(1); }
  return (data || [])
    .filter(f => f.id && f.name.toLowerCase().endsWith(".pdf"))
    .map(f => f.name);
}

// ── Process one PDF ───────────────────────────────────────────────────────────
async function processPdf(filename) {
  const docType = filename.toLowerCase().includes("dental") ? "DENTAL" : "EOC";
  console.log(`\n📄  [${docType}] ${filename}`);

  const buffer   = await downloadPdf(filename);
  console.log(`   Size: ${(buffer.length/1024).toFixed(0)} KB`);

  const extracted = await extractTextFromPdf(buffer);
  const text      = extracted.text;
  console.log(`   Extracted: ${text.length.toLocaleString()} chars | Pages: ${extracted.pages}`);

  if (text.length < 100) {
    console.warn("   ⚠️  Very little text — skipping");
    return { filename, chunks: 0, status: "skipped" };
  }

  const chunks   = chunkText(text, filename);
  console.log(`   Chunks: ${chunks.length}`);

  const embedded = await embedChunks(chunks);
  const saved    = await saveChunks(embedded);
  console.log(`   ✅  ${saved} chunks saved`);
  return { filename, chunks: saved, status: "ok" };
}

// ── Stats ─────────────────────────────────────────────────────────────────────
async function showStats() {
  const { data } = await db.from("document_chunks").select("doc_name, doc_type");
  if (!data || data.length === 0) {
    console.log("\n📭  No chunks ingested yet.\n"); return;
  }
  const byDoc = {};
  data.forEach(r => {
    if (!byDoc[r.doc_name]) byDoc[r.doc_name] = { type: r.doc_type, count: 0 };
    byDoc[r.doc_name].count++;
  });
  console.log("\n── Ingested Documents ──────────────────────────────────────");
  Object.entries(byDoc).forEach(([name, info]) => {
    console.log(`  [${info.type.toUpperCase().padEnd(6)}] ${name.padEnd(55)} ${info.count} chunks`);
  });
  console.log(`\n  Total: ${Object.keys(byDoc).length} docs | ${data.length} chunks`);
  console.log("  ✅  EOC & Dental Playground is ready!\n");
}

// ── MAIN ──────────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);
  console.log("\n╔══════════════════════════════════════════════════╗");
  console.log("║   MIPI — PDF → Vector Database Ingestion         ║");
  console.log("╚══════════════════════════════════════════════════╝\n");

  if (args.includes("--stats")) { await showStats(); return; }

  const pdfs = await listPdfs();
  console.log(`📦  Found ${pdfs.length} PDF(s) in bucket "${BUCKET}"\n`);

  if (args.includes("--list")) {
    pdfs.forEach((f, i) => console.log(`  ${i+1}. ${f}`));
    return;
  }

  if (pdfs.length === 0) {
    console.log("No PDFs found. Upload PDFs to Supabase Storage → pdfs bucket.");
    return;
  }

  const results = [];
  for (const filename of pdfs) {
    try {
      results.push(await processPdf(filename));
    } catch(e) {
      console.error(`\n❌  FAILED: ${filename} — ${e.message}`);
      results.push({ filename, chunks: 0, status: "error" });
    }
  }

  const ok = results.filter(r => r.status === "ok");
  const failed = results.filter(r => r.status === "error");
  console.log(`\n✅  Done: ${ok.length} ingested | ${failed.length} failed`);
  console.log("Run --stats to verify.\n");
}

main().catch(e => { console.error("Fatal:", e.message); process.exit(1); });
