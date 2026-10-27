#!/usr/bin/env node
// Claude Code guard hook, identical in every Nura repo (keep the copies in sync).
// Enforces the "Working rules" in CLAUDE.md and docs/WORKFLOW.md (app repo):
//
//   node .claude/hooks/guard.mjs pre-tool   PreToolUse: deny or ask before risky tool calls
//   node .claude/hooks/guard.mjs session    SessionStart: tell Claude which branch it's on
//
// Deny  = never allowed for Claude (push to main, force-push to main/staging,
//         committing or reading secret files, committing on main).
// Ask   = allowed only after the person approves it in the permission prompt
//         (anything that changes production: AWS writes, EAS production
//         builds/submits/updates, starting the prod pipeline).
// Plain Node, no dependencies, so it runs on every laptop and in CI.

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PROTECTED = ["main", "master"];
const NO_FORCE = ["main", "master", "staging"];

// .env, .env.local, .env.stage, .env.production… but not .env.example.
// Plus signing keys, service accounts and keystores.
const SECRET_FILE =
  /(^|[\s/'"=:])(\.env(?!\.example\b)(\.[\w.-]+)?|credentials\.json|[\w.-]*\.(jks|keystore|pem|p8|p12|key)|service-account[\w.-]*\.json|keystore\.properties)(?=$|[\s'";|&)<>])/;
const READS_FILE =
  /(^|[\s;|&(])(cat|less|more|head|tail|bat|grep|egrep|rg|ag|sed|awk|cut|sort|uniq|source|\.|xxd|od|strings|base64|cp|mv|scp|rsync|curl|wget|nc|open|code|vi|vim|nano|python3?|node|ruby|perl|jq|diff|cmp|tee|printenv|env)\s/;

function git(args) {
  try {
    return execFileSync("git", args, { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
  } catch {
    return "";
  }
}

function out(decision, reason) {
  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: decision,
        permissionDecisionReason: reason,
      },
    }),
  );
  process.exit(0);
}
const deny = (reason) => out("deny", `${reason} (Nura working rules: CLAUDE.md, docs/WORKFLOW.md)`);
const ask = (reason) => out("ask", reason);

// Splits a shell line into its separate commands (good enough for guarding,
// not a full shell parser).
const commandsOf = (line) =>
  line
    .split(/&&|\|\||;|\n|\|/)
    .map((c) => c.trim())
    .filter(Boolean);

function checkGit(cmd) {
  const m = cmd.match(/^git(\s+-C\s+("[^"]+"|'[^']+'|\S+))?\s+(\S+)(.*)$/);
  if (!m) return;
  const sub = m[3];
  const rest = m[4] || "";
  const dirArgs = m[2] ? ["-C", m[2].replace(/^["']|["']$/g, "")] : [];
  const branch = git([...dirArgs, "rev-parse", "--abbrev-ref", "HEAD"]);

  if (sub === "push") {
    const words = rest.trim().split(/\s+/).filter(Boolean);
    const force = words.some((w) => w === "-f" || w === "--force" || w.startsWith("--force=") || /^-[a-zA-Z]*f/.test(w));
    const lease = words.some((w) => w.startsWith("--force-with-lease") || w.startsWith("--force-if-includes"));
    const refs = words.filter((w) => !w.startsWith("-")).slice(1); // after the remote
    const targets = refs.length
      ? refs.map((r) => r.replace(/^\+/, "").split(":").pop().replace(/^refs\/heads\//, ""))
      : [branch];
    if (words.includes("--all") || words.includes("--mirror")) deny("`git push --all/--mirror` is not allowed.");
    for (const t of targets) {
      if (PROTECTED.includes(t) || (t === "HEAD" && PROTECTED.includes(branch)))
        deny(`Pushing to \`${t === "HEAD" ? branch : t}\` is not allowed. Push a feature branch and open a PR to \`staging\`; \`main\` only changes through a reviewed PR from \`staging\`.`);
      const real = t === "HEAD" ? branch : t;
      if ((force || lease || refs.some((r) => r.startsWith("+"))) && NO_FORCE.includes(real))
        deny(`Force-pushing \`${real}\` is not allowed.`);
    }
    if (force && !lease) deny("Use `--force-with-lease` instead of `--force` (and only on your own feature branch).");
    return;
  }

  if (sub === "commit" || sub === "merge" || sub === "cherry-pick" || sub === "revert") {
    if (PROTECTED.includes(branch))
      deny(`You're on \`${branch}\`. Create a branch from \`origin/staging\` first (\`git switch -c feat/<name> origin/staging\`).`);
    if (sub === "commit") {
      const staged = git([...dirArgs, "diff", "--cached", "--name-only"]).split("\n").filter(Boolean);
      const willAdd = /\s(-a|--all|-[a-zA-Z]*a[a-zA-Z]*)(\s|$)/.test(rest)
        ? git([...dirArgs, "diff", "--name-only"]).split("\n").filter(Boolean)
        : [];
      const bad = [...staged, ...willAdd].filter((f) => SECRET_FILE.test(" " + f + " "));
      if (bad.length) deny(`Secret files are staged: ${bad.join(", ")}. Unstage them (\`git restore --staged <file>\`); secrets live in AWS Secrets Manager / EAS / Vercel, never in git.`);
    }
    return;
  }

  if (sub === "add" && /\s(-f|--force)(\s|$)/.test(rest) && SECRET_FILE.test(rest + " "))
    deny("Force-adding an ignored secret file is not allowed.");
}

function checkProd(cmd) {
  if (/^(npx\s+)?eas\s+(submit|build\b.*--profile[ =]production|update\b.*(--branch|--channel)[ =]production)/.test(cmd) ||
      /^(npx\s+)?eas\s+(env:(create|update|delete)|secret:)/.test(cmd))
    ask("This builds, ships or changes production for the mobile app. Approve only if you asked for it.");

  if (/^aws\s/.test(cmd)) {
    const action = (cmd.match(/^aws\s+(?:--\S+\s+\S+\s+)*\S+\s+(\S+)/) || [])[1] || "";
    const readOnly = /^(get-|list-|describe-|head-|ls$|wait$|help$|tail$|filter-log-events|lookup-|query$|scan$|search-|batch-get-|start-session$)/.test(action) ||
      /^aws\s+(sts\s+get-caller-identity|s3\s+ls|logs\s+tail|configure\s+(list|get))/.test(cmd);
    if (/^aws\s+secretsmanager\s+get-secret-value/.test(cmd))
      deny("Reading secret values is not allowed. Compare key names in the console, or ask the person to check a value.");
    if (/^aws\s+ssm\s+(send-command|start-session)/.test(cmd))
      ask("This runs commands on a server. Approve only if you asked for it.");
    if (!readOnly) ask(`\`aws … ${action}\` changes AWS resources (prod and staging share one account). Approve only if you asked for it.`);
  }

  if (/^(npx\s+)?vercel\s+(--prod|deploy\b.*--prod|env\s+(add|rm|pull)|promote|rollback|domains|alias|remove|rm)\b/.test(cmd))
    ask("This changes a live Vercel site or its env. Approve only if you asked for it.");
}

function preTool() {
  let input = {};
  try {
    input = JSON.parse(readFileSync(0, "utf8") || "{}");
  } catch {
    process.exit(0);
  }
  const tool = input.tool_name || "";
  const ti = input.tool_input || {};

  if (/^(Read|Edit|Write|MultiEdit|NotebookEdit)$/.test(tool)) {
    const f = String(ti.file_path || ti.notebook_path || "");
    if (SECRET_FILE.test(" " + f.split("/").pop() + " "))
      deny(`\`${f.split("/").pop()}\` holds secrets. Don't read or edit it: use \`.env.example\` for key names, and ask the person to change real values.`);
    process.exit(0);
  }

  if (tool !== "Bash") process.exit(0);
  const line = String(ti.command || "");

  for (const cmd of commandsOf(line)) {
    checkGit(cmd);
    checkProd(cmd);
  }
  for (const cmd of commandsOf(line)) {
    if (SECRET_FILE.test(" " + cmd + " ") && READS_FILE.test(" " + cmd + " ") && !/^git\s+(check-ignore|status|ls-files|rm\s+--cached)/.test(cmd))
      deny("This command reads or copies a secret file (.env, keystore, credentials). Use `.env.example` for key names; ask the person for anything else.");
  }
  if (/\brm\s+-[a-zA-Z]*r[a-zA-Z]*f?\s+(\/|~|\$HOME|\.)(\s|$)/.test(line)) deny("Recursive delete of a root, home or repo directory is not allowed.");
  process.exit(0);
}

function session() {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  if (!branch) process.exit(0);
  const dirty = git(["status", "--porcelain"]).split("\n").filter(Boolean).length;
  const behind = git(["rev-list", "--count", `HEAD..origin/staging`]);
  const notes = [`Git branch: ${branch}.`];
  if (PROTECTED.includes(branch) || branch === "staging")
    notes.push(`Don't commit here: start work with \`git switch -c <type>/<name> origin/staging\`.`);
  if (dirty) notes.push(`${dirty} uncommitted change(s) already in the tree: they may be someone else's work in progress. Don't commit, stash or discard them; use a git worktree if you need a clean tree.`);
  if (behind && behind !== "0" && !PROTECTED.includes(branch)) notes.push(`${behind} commit(s) behind origin/staging (as of the last fetch).`);
  process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: notes.join(" ") } }));
}

const mode = process.argv[2];
if (mode === "pre-tool") preTool();
else if (mode === "session") session();
