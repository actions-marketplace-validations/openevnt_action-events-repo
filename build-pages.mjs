import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { findNodeAtLocation, parseTree } from "jsonc-parser";

const FEED_FILE = "feed.json";
const INDEX_FILE = "index.json";

const defaultPagesUrl = (repository) => {
	const [owner, repo] = repository?.toLowerCase().split("/") ?? [];
	if (!owner || !repo) return undefined;
	return repo === `${owner}.github.io` ? `https://${repo}/` : `https://${owner}.github.io/${repo}/`;
};

const [eventsDir, outDir, schemaUrl, pagesUrlArgument] = process.argv.slice(2);
const pagesUrl = pagesUrlArgument || defaultPagesUrl(process.env.GITHUB_REPOSITORY);

const escapeCommandData = (text) => text.replaceAll("%", "%25").replaceAll("\r", "%0D").replaceAll("\n", "%0A");
const escapeCommandProperty = (text) => escapeCommandData(text).replaceAll(":", "%3A").replaceAll(",", "%2C");

const reportError = (file, message, position) => {
	const properties = [`file=${escapeCommandProperty(relative(process.cwd(), file))}`];
	if (position) properties.push(`line=${position.line}`, `col=${position.column}`);
	console.log(`::error ${properties.join(",")}::${escapeCommandData(message)}`);
};

const positionAt = (text, offset) => {
	const before = text.slice(0, offset);
	return { line: before.split("\n").length, column: offset - before.lastIndexOf("\n") };
};

const pointerSegments = (pointer) =>
	pointer
		.split("/")
		.slice(1)
		.map((segment) => segment.replaceAll("~1", "/").replaceAll("~0", "~"))
		.map((segment) => (/^\d+$/.test(segment) ? Number(segment) : segment));

const describeSchemaError = (error) => {
	const where = error.instancePath || "/";
	const extra = error.params?.additionalProperty ?? error.params?.allowedValues?.join(", ") ?? error.params?.allowedValue;
	return `${where} ${error.message}${extra ? `: ${extra}` : ""}`;
};

const findEventFiles = (dir) =>
	readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
		if (entry.name === "node_modules" || entry.name.startsWith(".")) return [];
		const path = join(dir, entry.name);
		if (entry.isDirectory()) return findEventFiles(path);
		return entry.name.endsWith(".evnt.json") ? [path] : [];
	});

const firstTranslation = (translations) => translations?.en ?? Object.values(translations ?? {})[0];

const readablePartialDate = (date) => date.replace(/\[.*\]$/, "").replace("T", " ");

const occurrenceSpan = (occurrence) =>
	[occurrence.start, occurrence.end].filter(Boolean).map(readablePartialDate).join(" – ");

const feedSummary = (event) => {
	const occurrences = event.occurrences ?? [];
	const firstSpan = occurrences[0] && occurrenceSpan(occurrences[0]);
	const lines = [
		firstTranslation(event.venue?.name),
		firstSpan && (occurrences.length > 1 ? `${firstSpan} (+${occurrences.length - 1} more)` : firstSpan),
	].filter(Boolean);
	return lines.length ? lines.join("\n") : firstTranslation(event.name);
};

if (!eventsDir || !outDir || !schemaUrl || !pagesUrl) {
	console.error("Usage: build-pages.mjs <events-dir> <out-dir> <schema-url> [pages-url, defaults from GITHUB_REPOSITORY]");
	process.exit(2);
}

if (!existsSync(eventsDir)) {
	console.log(`::error::Events folder not found: ${escapeCommandData(eventsDir)}`);
	process.exit(1);
}

const schemaResponse = await fetch(schemaUrl);
if (!schemaResponse.ok) {
	console.log(`::error::Could not fetch the Open Evnt schema from ${schemaUrl}: HTTP ${schemaResponse.status}`);
	process.exit(1);
}
const ajv = new Ajv2020({ strict: true, allErrors: true });
addFormats(ajv);
const validate = ajv.compile(await schemaResponse.json());

const out = resolve(outDir);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const siteUrl = new URL(pagesUrl.endsWith("/") ? pagesUrl : `${pagesUrl}/`);
const feedItems = [];
const indexItems = [];
let invalid = 0;

for (const file of findEventFiles(eventsDir)) {
	const text = readFileSync(file, "utf-8");
	let event;
	try {
		event = JSON.parse(text);
	} catch (error) {
		reportError(file, `Invalid JSON: ${error.message}`);
		invalid++;
		continue;
	}

	if (!validate(event)) {
		const tree = parseTree(text);
		for (const error of validate.errors) {
			const node = tree && findNodeAtLocation(tree, pointerSegments(error.instancePath));
			reportError(file, describeSchemaError(error), node && positionAt(text, node.offset));
		}
		invalid++;
		continue;
	}

	const path = relative(eventsDir, file);
	mkdirSync(dirname(join(out, path)), { recursive: true });
	copyFileSync(file, join(out, path));

	indexItems.push({
		href: new URL(path.split(sep).map(encodeURIComponent).join("/"), siteUrl).href,
		name: event.name,
	});
	feedItems.push({
		id: event.id,
		url: path,
		title: firstTranslation(event.name),
		content_text: feedSummary(event),
		date_modified: new Date(statSync(file).mtimeMs).toISOString(),
	});
	console.log(`Valid: ${path}`);
}

feedItems.sort((a, b) => b.date_modified.localeCompare(a.date_modified));
indexItems.sort((a, b) => a.href.localeCompare(b.href));

writeFileSync(
	join(out, FEED_FILE),
	JSON.stringify({ version: "https://jsonfeed.org/version/1.1", title: "Open Evnt Events", feed_url: FEED_FILE, items: feedItems }, null, "\t"),
);
writeFileSync(
	join(out, INDEX_FILE),
	JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), total: indexItems.length, items: indexItems }, null, "\t"),
);

console.log(`\nPublished ${indexItems.length} events, ${FEED_FILE} and ${INDEX_FILE}${invalid ? `; ${invalid} invalid` : ""}`);
if (invalid > 0) process.exit(1);
