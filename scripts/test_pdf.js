// Quick diagnostic - run: node scripts/test_pdf.js
const { createClient } = require("@supabase/supabase-js");
const fs   = require("fs");
const path = require("path");

// Load env
[".env.local",".env"].forEach(function(name) {
  var p = path.join(__dirname, "..", name);
  if (fs.existsSync(p)) {
    fs.readFileSync(p,"utf8").split("\n").forEach(function(line) {
      var m = line.match(/^([^#=\s][^=]*)=(.*)/);
      if (m) process.env[m[1].trim()] = m[2].trim();
    });
  }
});

var db = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

async function test() {
  console.log("Downloading first PDF...");
  var { data, error } = await db.storage.from("pdfs")
    .download("2026 EOC SummaCare Sapphire.pdf");

  if (error) { console.error("Download error:", error.message); return; }

  console.log("data type:", typeof data);
  console.log("data constructor:", data && data.constructor && data.constructor.name);

  var ab  = await data.arrayBuffer();
  var buf = Buffer.from(ab);
  console.log("Buffer length:", buf.length);
  console.log("First 10 bytes:", buf.slice(0,10).toString("hex"));
  console.log("PDF header check:", buf.slice(0,4).toString() === "%PDF" ? "✅ Valid PDF" : "❌ Not a PDF");

  // Save to disk and try pdf-parse
  var tmpPath = path.join(__dirname, "test_temp.pdf");
  fs.writeFileSync(tmpPath, buf);
  console.log("Saved to:", tmpPath);

  var pdfLib = require("pdf-parse");
  console.log("pdf-parse keys:", Object.keys(pdfLib));
  console.log("pdf-parse type:", typeof pdfLib);
  console.log("pdf-parse.default type:", typeof pdfLib.default);
  console.log("Is function:", typeof pdfLib === "function");
  var pdfFn  = typeof pdfLib === "function" ? pdfLib : pdfLib.default || pdfLib;

  try {
    // Try with buffer
    var r1 = await pdfFn(buf);
    console.log("From buffer — pages:", r1.numpages, "chars:", r1.text.length);
  } catch(e) {
    console.log("Buffer method failed:", e.message);
  }

  try {
    // Try with file read
    var fileBuf = fs.readFileSync(tmpPath);
    var r2 = await pdfFn(fileBuf);
    console.log("From file — pages:", r2.numpages, "chars:", r2.text.length);
    if (r2.text.length > 0) console.log("Sample:", r2.text.slice(0, 200));
  } catch(e) {
    console.log("File method failed:", e.message);
  }

  fs.unlinkSync(tmpPath);
}

test().catch(console.error);
