// Repository guard: reject common private-data mistakes in the Git index.
// Prints file names and reasons only, never contents.
import { execFileSync } from "node:child_process";

const PATTERNS = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  [
    "GitHub credential",
    /\b(?:gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{40,})\b/,
  ],
  [
    "provider credential",
    /\b(?:sk-[A-Za-z0-9_-]{20,}|sk_(?:live|test)_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,})\b/,
  ],
  ["AWS access key", /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ["AWS account id", /\b\d{12}\b/],
  [
    "real Stripe partner source",
    /aws\.partner\/stripe\.com\/ed_[A-Za-z0-9]{20,}/,
  ],
  ["personal path", /\/(?:Users|home)\/[A-Za-z0-9_.-]+\//],
  [
    "private IP",
    /\b(?:192\.168|10\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01]))\.\d{1,3}\.\d{1,3}\b/,
  ],
];
const PRIVATE_NAME =
  /(^|\/)\.env(?!\.example$)|\.(pem|key|p12|pfx)$|cdk-outputs\.json$/;

const files = execFileSync("git", ["ls-files", "-z"])
  .toString()
  .split("\0")
  .filter(Boolean);
const problems = [];
for (const name of files) {
  if (PRIVATE_NAME.test(name)) problems.push([name, "private runtime file"]);
  const data = execFileSync("git", ["show", `:${name}`]);
  if (data.includes(0) || data.length > 2 * 1024 * 1024) {
    problems.push([name, "binary or oversized file"]);
    continue;
  }
  const text = data.toString("utf8");
  for (const [label, re] of PATTERNS) {
    if (re.test(text)) problems.push([name, label]);
  }
}
for (const [name, reason] of problems) console.error(`${name}: ${reason}`);
if (problems.length) process.exit(1);
console.log(
  `Repository guard passed: ${files.length} indexed files; no common private-data patterns found.`,
);
