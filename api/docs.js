// api/docs.js — EOC & Dental Playground RAG API
// Queries document_chunks table using pgvector similarity search
// then passes relevant chunks to GPT-4o for citation-aware answers.

import { createClient } from "@supabase/supabase-js";

export const config = { api: { bodyParser: true } };

function getDB() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

// ── Embed a question via OpenAI ───────────────────────────────────────────────
async function embed(text) {
  const apiKey = process.env.OPENAI_API_KEY;
  const res = await fetch("https://api.openai.com/v1/embeddings", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model: "text-embedding-3-small",
      input: text,
    }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error("Embed failed: " + (d.error?.message || res.status));
  return d.data[0].embedding;
}

// ── Vector similarity search ──────────────────────────────────────────────────
async function searchChunks(db, embedding, docType, topK) {
  // Try pgvector RPC function first (fastest)
  const { data: rpcData, error: rpcErr } = await db.rpc("match_chunks", {
    query_embedding:  embedding,
    match_count:      topK,
    filter_doc_type:  docType === "all" ? null : docType,
  });

  if (!rpcErr && rpcData && rpcData.length > 0) {
    console.log("[docs] match_chunks RPC returned:", rpcData.length, "chunks");
    return rpcData;
  }

  // Fallback: fetch all chunks and rank by cosine similarity in JS
  // (used if match_chunks function doesn't exist yet)
  console.log("[docs] RPC not available, using JS cosine fallback");
  let q = db.from("document_chunks").select("id,doc_name,doc_type,page_number,section,chunk_text,embedding");
  if (docType !== "all") q = q.eq("doc_type", docType);
  const { data: rows, error } = await q.limit(2000);
  if (error) throw new Error("Chunk fetch failed: " + error.message);

  // Cosine similarity
  function cosine(a, b) {
    let dot = 0, na = 0, nb = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i]*b[i]; na += a[i]*a[i]; nb += b[i]*b[i];
    }
    return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  }

  return rows
    .filter(r => r.embedding)
    .map(r => {
      // embedding stored as "[0.1,0.2,...]" string
      const vec = typeof r.embedding === "string"
        ? JSON.parse(r.embedding) : r.embedding;
      return { ...r, similarity: cosine(embedding, vec) };
    })
    .sort((a, b) => b.similarity - a.similarity)
    .slice(0, topK);
}

// ── GPT-4o answer with citations ──────────────────────────────────────────────
async function generateAnswer(question, chunks) {
  const apiKey = process.env.OPENAI_API_KEY;
  const context = chunks.map((c, i) =>
    `--- Source ${i+1} ---\n`
    + `Document: ${c.doc_name}\n`
    + `Type: ${c.doc_type?.toUpperCase()}\n`
    + `Page: ${c.page_number || "?"} | Section: ${c.section || "General"}\n\n`
    + c.chunk_text
  ).join("\n\n");

  const prompt =
    "You are a Medicare Advantage plan document analyst for HealthWorksAI.\n"
    + "Answer the question using ONLY the document excerpts below.\n"
    + "Rules:\n"
    + "- Cite the document name, page, and section for every claim.\n"
    + "- Flag exclusions, limitations, prior auth requirements explicitly.\n"
    + "- If the answer is not in the excerpts, say so clearly — do not guess.\n"
    + "- Be concise. Use bullet points for lists.\n\n"
    + "DOCUMENT EXCERPTS:\n" + context
    + "\n\nQUESTION: " + question;

  const res = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type":  "application/json",
      "Authorization": "Bearer " + apiKey,
    },
    body: JSON.stringify({
      model:      "gpt-4o",
      max_tokens: 1500,
      messages:   [{ role: "user", content: prompt }],
    }),
  });
  const d = await res.json();
  if (!res.ok) throw new Error("GPT-4o failed: " + (d.error?.message || res.status));
  return d.choices[0].message.content.trim();
}

// ── Stats handler ─────────────────────────────────────────────────────────────
async function handleStats(db) {
  // Use count with grouping via RPC to avoid row limit
  const { data, error } = await db
    .from("document_chunks")
    .select("doc_name, doc_type", { count: "exact" })
    .limit(5000);

  if (error) return { total: 0, eoc: 0, dental: 0, ready: false };

  const byDoc = {};
  (data || []).forEach(r => {
    if (!byDoc[r.doc_name]) byDoc[r.doc_name] = r.doc_type;
  });

  const docs   = Object.entries(byDoc);
  const eocDocs    = docs.filter(([,t]) => t === "eoc").length;
  const dentalDocs = docs.filter(([,t]) => t === "dental").length;

  return {
    total:   docs.length,
    eoc:     eocDocs,
    dental:  dentalDocs,
    ready:   docs.length > 0,
    documents: docs.map(([name, type]) => ({ name, type })),
  };
}

// ── Main handler ──────────────────────────────────────────────────────────────
export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin",  "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(200).end();
  if (req.method !== "POST")
    return res.status(405).json({ error: "Method not allowed" });

  const { action, question, doc_type = "all" } = req.body || {};

  const db = getDB();
  if (!db) return res.status(500).json({ error: "Supabase not configured" });

  try {
    // ── Stats ────────────────────────────────────────────────────────────────
    if (action === "stats") {
      const stats = await handleStats(db);
      return res.status(200).json(stats);
    }

    // ── Query ─────────────────────────────────────────────────────────────────
    if (action === "query") {
      if (!question || question.trim().length < 3) {
        return res.status(400).json({ error: "Question too short" });
      }

      console.log("[docs] question:", question, "| doc_type:", doc_type);

      // 1. Embed question
      const embedding = await embed(question);

      // 2. Find relevant chunks
      const chunks = await searchChunks(db, embedding, doc_type, 5);

      if (!chunks || chunks.length === 0) {
        return res.status(200).json({
          answer: "No relevant passages found in the loaded documents for your question. "
            + "Try rephrasing or check that the relevant PDFs have been ingested.",
          sources: [],
        });
      }

      // 3. Generate answer
      const answer = await generateAnswer(question, chunks);

      // 4. Format sources for UI chips
      const sources = chunks.map(c => ({
        doc_name:   c.doc_name,
        doc_type:   c.doc_type,
        page:       c.page_number,
        section:    c.section || "General",
        similarity: c.similarity
          ? (c.similarity * 100).toFixed(0) + "%" : null,
        chunk_text: c.chunk_text
          ? c.chunk_text.slice(0, 300) + (c.chunk_text.length > 300 ? "..." : "")
          : "",
      }));

      return res.status(200).json({ answer, sources });
    }

    return res.status(400).json({ error: "Invalid action. Use: stats | query" });

  } catch (err) {
    console.error("[docs]", err.message);
    return res.status(500).json({ error: err.message });
  }
}
