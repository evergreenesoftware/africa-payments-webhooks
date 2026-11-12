// Concatenate the docs into docs/public/llms-full.txt (read by AI assistants). Run before `vitepress build docs`.
import { readFileSync, writeFileSync } from 'node:fs';
const pages = ['guide/getting-started', 'guide/raw-body', 'guide/providers', 'guide/idempotency', 'guide/testing', 'guide/security', 'guide/python'];
const head = readFileSync(new URL('./public/llms.txt', import.meta.url), 'utf8').split('\n## Docs')[0];
const body = pages.map((p) => `\n\n<!-- ${p} -->\n${readFileSync(new URL(`./${p}.md`, import.meta.url), 'utf8')}`).join('');
writeFileSync(new URL('./public/llms-full.txt', import.meta.url), `${head}${body}\n`);
