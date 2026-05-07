const fs = require("fs");
const path = require("path");

function argValue(name, fallback) {
  const index = process.argv.indexOf(name);
  if (index === -1) return fallback;
  return process.argv[index + 1] || fallback;
}

function classify(name) {
  if (name.includes("go-live")) return "Go-live";
  if (name.includes("sales-launch")) return "Commercial launch";
  if (name.includes("latest")) return "Pilot";
  return "Other";
}

function row(file) {
  const stat = fs.statSync(file.fullPath);
  return {
    name: file.name,
    kind: classify(file.name),
    size: stat.size,
    updatedAt: stat.mtime.toISOString(),
    ext: path.extname(file.name).replace(".", "")
  };
}

const reportsDir = path.resolve(argValue("--reports-dir", path.join("data", "reports")));
const outputPath = path.resolve(argValue("--out", path.join("docs", "REPORT-INDEX.md")));
const files = fs.existsSync(reportsDir)
  ? fs.readdirSync(reportsDir)
    .filter(name => [".json", ".md"].includes(path.extname(name)))
    .map(name => row({ name, fullPath: path.join(reportsDir, name) }))
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  : [];

const lines = [
  "# WorkFlow Pro Report Index",
  "",
  `Generated: ${new Date().toISOString()}`,
  `Reports directory: ${reportsDir}`,
  "",
  "| Type | File | Format | Updated | Size |",
  "| --- | --- | --- | --- | --- |",
  ...(files.length
    ? files.map(file => `| ${file.kind} | ${file.name} | ${file.ext} | ${file.updatedAt} | ${file.size} |`)
    : ["| - | No reports found | - | - | - |"]),
  ""
];

fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, lines.join("\n"));
console.log(JSON.stringify({ ok: true, outputPath, reports: files.length }, null, 2));
