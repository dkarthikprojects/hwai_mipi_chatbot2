-- ─────────────────────────────────────────────────────────────────────────────
-- MIPI POWER HOUSE — Document Intelligence Schema
-- Run this in Supabase SQL Editor AFTER schema.sql
--
-- Prerequisites:
--   - pgvector extension (enabled below)
--   - Supabase Storage bucket named "plan-documents" (created below)
--
-- Tables:
--   documents        — one row per uploaded PDF (metadata + Storage path)
--   document_chunks  — one row per text chunk (with vector embedding)
--
-- Function:
--   match_document_chunks — cosine similarity search, called by api/docs.js
-- ─────────────────────────────────────────────────────────────────────────────

-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: documents
-- One row per uploaded PDF file. Tracks metadata and ingestion status.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS documents (
  id                UUID        DEFAULT uuid_generate_v4() PRIMARY KEY,
  doc_name          TEXT        NOT NULL UNIQUE,  -- filename e.g. "Humana_Gold_EOC_2026.pdf"
  doc_type          VARCHAR(20) NOT NULL,         -- "eoc" or "dental"
  plan_name         TEXT,                         -- e.g. "Humana Gold Plus H1234-001"
  parent_org        TEXT,                         -- e.g. "Humana Inc."
  contract_id       VARCHAR(20),
  plan_id           INTEGER,
  state_code        CHAR(2),
  plan_year         INTEGER     DEFAULT 2026,
  storage_path      TEXT,                         -- Supabase Storage path
  page_count        INTEGER,
  chunk_count       INTEGER     DEFAULT 0,
  ingested_at       TIMESTAMPTZ,
  status            VARCHAR(20) DEFAULT 'pending', -- pending, ingested, error
  error_msg         TEXT,
  created_at        TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX idx_docs_type      ON documents(doc_type);
CREATE INDEX idx_docs_org       ON documents(parent_org);
CREATE INDEX idx_docs_state     ON documents(state_code);
CREATE INDEX idx_docs_status    ON documents(status);

-- ─────────────────────────────────────────────────────────────────────────────
-- TABLE: document_chunks
-- One row per text chunk. Stores the raw text AND its vector embedding.
-- text-embedding-3-small produces 1536-dimensional vectors.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS document_chunks (
  id            UUID         DEFAULT uuid_generate_v4() PRIMARY KEY,
  document_id   UUID         REFERENCES documents(id) ON DELETE CASCADE,
  doc_name      TEXT         NOT NULL,
  doc_type      VARCHAR(20)  NOT NULL,
  plan_name     TEXT,
  parent_org    TEXT,
  state_code    CHAR(2),
  plan_year     INTEGER      DEFAULT 2026,
  -- Location within document
  page_number   INTEGER,
  section       TEXT,        -- e.g. "Benefits at a Glance", "Exclusions"
  chunk_index   INTEGER,     -- position of this chunk within the document
  -- Content
  chunk_text    TEXT         NOT NULL,
  char_count    INTEGER,
  -- Vector embedding (1536 dims for text-embedding-3-small)
  embedding     vector(1536),
  created_at    TIMESTAMPTZ  DEFAULT NOW()
);

-- Index for fast filtering before vector search
CREATE INDEX idx_chunks_doc_id   ON document_chunks(document_id);
CREATE INDEX idx_chunks_doc_type ON document_chunks(doc_type);
CREATE INDEX idx_chunks_org      ON document_chunks(parent_org);
CREATE INDEX idx_chunks_state    ON document_chunks(state_code);
CREATE INDEX idx_chunks_section  ON document_chunks(section);

-- IVFFlat index for approximate nearest neighbor search
-- lists=10 is appropriate for under 50 documents (~a few thousand chunks)
-- Re-run with lists=50-100 if you scale to thousands of documents
CREATE INDEX idx_chunks_embedding
  ON document_chunks USING ivfflat (embedding vector_cosine_ops)
  WITH (lists = 10);

-- ─────────────────────────────────────────────────────────────────────────────
-- FUNCTION: match_document_chunks
-- Called by api/docs.js for vector similarity search.
-- Returns the top-k most semantically similar chunks to the query embedding.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION match_document_chunks(
  query_embedding   vector(1536),
  match_count       INTEGER DEFAULT 5,
  doc_type_filter   TEXT    DEFAULT NULL
)
RETURNS TABLE (
  id            UUID,
  doc_name      TEXT,
  doc_type      VARCHAR(20),
  plan_name     TEXT,
  parent_org    TEXT,
  state_code    CHAR(2),
  page_number   INTEGER,
  section       TEXT,
  chunk_text    TEXT,
  similarity    FLOAT
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    dc.id,
    dc.doc_name,
    dc.doc_type,
    dc.plan_name,
    dc.parent_org,
    dc.state_code,
    dc.page_number,
    dc.section,
    dc.chunk_text,
    1 - (dc.embedding <=> query_embedding) AS similarity
  FROM document_chunks dc
  WHERE
    dc.embedding IS NOT NULL
    AND (doc_type_filter IS NULL OR dc.doc_type = doc_type_filter)
  ORDER BY dc.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE documents        ENABLE ROW LEVEL SECURITY;
ALTER TABLE document_chunks  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "service_role_all" ON documents
  FOR ALL USING (true);
CREATE POLICY "service_role_all" ON document_chunks
  FOR ALL USING (true);

-- ─────────────────────────────────────────────────────────────────────────────
-- STORAGE BUCKET
-- Run this to create the storage bucket for PDFs (if not already created via UI)
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public)
  VALUES ('plan-documents', 'plan-documents', false)
  ON CONFLICT (id) DO NOTHING;

-- Storage policy: service role can upload/read/delete
CREATE POLICY "service_role_storage" ON storage.objects
  FOR ALL TO service_role USING (bucket_id = 'plan-documents');
