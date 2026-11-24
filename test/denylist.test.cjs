const assert = require("node:assert/strict");
const {execFileSync} = require("node:child_process");
const {createHash} = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const root = path.resolve(__dirname, "..");
const hashFile = "test/data/denylist.sha256";
const hash = (token) => createHash("sha256")
  .update(`selecto-denylist-v1:${token.toLowerCase()}`).digest("hex");

function violations(text, hashes) {
  const found = [];
  text.toLowerCase().split(/\r?\n/).forEach((line, index) => {
    for (const match of line.matchAll(/[a-z0-9_.:-]+/g)) {
      const token = match[0].replace(/^[.:-]+|[.:-]+$/g, "");
      for (const candidate of new Set([token, ...token.split(/[.\-/]/)])) {
        if (!candidate) continue;
        const digest = hash(candidate);
        if (hashes.has(digest)) found.push({line: index + 1, hash: digest});
      }
    }
  });
  return found;
}

test("the domain-name guard catches planted tokens and path pieces in memory", () => {
  const planted = "invented_guard_token";
  const digest = hash(planted);
  const hashes = new Set([digest]);
  for (const text of [planted.toUpperCase(), `...:${planted}:---`, `bill_to.${planted}`,
    `prefix-${planted}.md`, `fixtures/${planted}/example.js`]) {
    assert.deepEqual(violations(`safe\n${text}`, hashes), [{line: 2, hash: digest}]);
  }
  assert.deepEqual(violations(`${planted}_suffix Namespace::${planted}`, hashes), []);
  const qualified = `Namespace::${planted}`;
  assert.deepEqual(violations(qualified, new Set([hash(qualified)])), [{line: 1, hash: hash(qualified)}]);
  assert.deepEqual(violations("12345", new Set([hash("12345")])), [{line: 1, hash: hash("12345")}]);
});

test("the domain-name guard catches planted CSS prefixes in memory", () => {
  const prefix = "inventedbrand";
  const digest = hash(prefix);
  const hashes = new Set([digest]);
  for (const css of [
    `--${prefix}-name: 1px;`,
    `.${prefix}-name { display: block; }`,
    `top: var(--${prefix}-name, 0px);`,
  ]) {
    assert.deepEqual(violations(`/* neutral */\n${css}`, hashes), [{line: 2, hash: digest}]);
  }
});

test("repository text and file paths contain no denylisted domain names", () => {
  const entries = fs.readFileSync(path.join(root, hashFile), "utf8").trim().split(/\r?\n/);
  assert.ok(entries.length > 0);
  assert.ok(entries.every((entry) => /^[a-f0-9]{64}$/.test(entry)), "one lowercase SHA-256 per line");
  const hashes = new Set(entries);
  // Include new worktree files so the guard is effective before staging too.
  const files = execFileSync("git", ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {cwd: root, encoding: "utf8"}).split("\0").filter(Boolean);
  const failures = [];
  const record = (file, text) => {
    for (const match of violations(text, hashes)) failures.push(`${file}:${match.line}: ${match.hash}`);
  };
  for (const file of files) {
    if (file === hashFile) continue;
    record(file, file);
    const content = fs.readFileSync(path.join(root, file));
    if (content.includes(0)) continue;
    let text;
    try { text = new TextDecoder("utf-8", {fatal: true}).decode(content); }
    catch { continue; } // Binary files are outside the text guard.
    record(file, text);
  }
  assert.deepEqual(failures, [], failures.join("\n"));
});
