/**
 * Pre-build script to extract publishDate from all Astro articles
 * Used by astro.config.mjs to set accurate lastmod dates in sitemap
 */

import { readFileSync, writeFileSync, readdirSync, statSync } from 'fs';
import { join, basename } from 'path';

const PAGES_DIR = 'src/pages';
const OUTPUT_FILE = 'src/data/article-dates.json';

function extractPublishDate(filePath) {
  try {
    const content = readFileSync(filePath, 'utf-8');
    // Match: const publishDate = '2026-01-28';
    const match = content.match(/const\s+publishDate\s*=\s*['"](\d{4}-\d{2}-\d{2})['"]/);
    return match ? match[1] : null;
  } catch {
    return null;
  }
}

function getInsightsArticles(dir, articles = {}) {
  const entries = readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);

    if (entry.isDirectory()) {
      getInsightsArticles(fullPath, articles);
    } else if (entry.name.endsWith('.astro') && fullPath.includes('/insights/')) {
      const publishDate = extractPublishDate(fullPath);
      if (publishDate) {
        // Convert file path to URL path
        // src/pages/insights/foo.astro -> /insights/foo/
        // src/pages/sv/insights/foo.astro -> /sv/insights/foo/
        let urlPath = fullPath
          .replace(PAGES_DIR, '')
          .replace('.astro', '/')
          .replace(/\/index\/$/, '/');

        articles[`https://brightinteraction.com${urlPath}`] = publishDate;
      }
    }
  }

  return articles;
}

// Generate the mapping
const articleDates = getInsightsArticles(PAGES_DIR);

// Ensure data directory exists
import { mkdirSync } from 'fs';
try {
  mkdirSync('src/data', { recursive: true });
} catch {}

writeFileSync(OUTPUT_FILE, JSON.stringify(articleDates, null, 2));

console.log(`Generated article dates for ${Object.keys(articleDates).length} articles`);
console.log(`Output: ${OUTPUT_FILE}`);
