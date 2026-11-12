// Собирает src/App.jsx + src/style.css в один статический index.html
import { buildSync, transformSync } from "esbuild";
import { readFileSync, writeFileSync } from "node:fs";

const js = buildSync({
  entryPoints: ["src/App.jsx"],
  jsxFactory: "React.createElement",
  jsxFragment: "React.Fragment",
  target: "es2020",
  charset: "utf8",
  minify: true,
  write: false,
}).outputFiles[0].text;
const css = transformSync(readFileSync("src/style.css", "utf8"), { loader: "css", minify: true, charset: "utf8" }).code;

writeFileSync(
  "index.html",
  `<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>CONTENT.LAB</title>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter+Tight:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500;700&family=Instrument+Serif&display=swap">
<style>${css}</style></head><body><div id="root"></div>
<script src="https://cdnjs.cloudflare.com/ajax/libs/react/18.3.1/umd/react.production.min.js"></script><script src="https://cdnjs.cloudflare.com/ajax/libs/react-dom/18.3.1/umd/react-dom.production.min.js"></script>
<script>${js}</script></body></html>
`
);
console.log("index.html built");
