// Tests for guard.mjs. Run: node --test .claude/hooks/guard.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = fileURLToPath(new URL("./guard.mjs", import.meta.url));

function repo(branch) {
  const dir = mkdtempSync(join(tmpdir(), "nura-guard-"));
  const g = (...a) => execFileSync("git", a, { cwd: dir, stdio: "ignore" });
  g("init", "-q", "-b", "main");
  g("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-q", "--allow-empty", "-m", "init");
  if (branch !== "main") g("switch", "-q", "-c", branch);
  return dir;
}

function run(dir, tool_name, tool_input) {
  const r = spawnSync("node", [GUARD, "pre-tool"], { cwd: dir, input: JSON.stringify({ tool_name, tool_input }), encoding: "utf8" });
  return r.stdout ? JSON.parse(r.stdout).hookSpecificOutput.permissionDecision : "allow";
}
const bash = (dir, command) => run(dir, "Bash", { command });

const feat = repo("feat/x");
const main = repo("main");

test("pushes", () => {
  assert.equal(bash(feat, "git push origin feat/x"), "allow");
  assert.equal(bash(feat, "git push -u origin HEAD"), "allow");
  assert.equal(bash(feat, "git push origin HEAD:staging"), "allow");
  assert.equal(bash(feat, "git push origin main"), "deny");
  assert.equal(bash(feat, "git push origin HEAD:main"), "deny");
  assert.equal(bash(feat, "git push origin feat/x:refs/heads/main"), "deny");
  assert.equal(bash(main, "git push"), "deny");
  assert.equal(bash(feat, "git push --force origin staging"), "deny");
  assert.equal(bash(feat, "git push --force-with-lease origin staging"), "deny");
  assert.equal(bash(feat, "git push origin +staging"), "deny");
  assert.equal(bash(feat, "git push -f origin feat/x"), "deny");
  assert.equal(bash(feat, "git push --force-with-lease origin feat/x"), "allow");
  assert.equal(bash(feat, "npm test && git push origin main"), "deny");
});

test("commits", () => {
  assert.equal(bash(main, 'git commit -m "x"'), "deny");
  assert.equal(bash(main, "git merge staging"), "deny");
  assert.equal(bash(feat, 'git commit -m "x"'), "allow");
  writeFileSync(join(feat, ".env"), "SECRET=1\n");
  execFileSync("git", ["add", "-f", ".env"], { cwd: feat });
  assert.equal(bash(feat, 'git commit -m "x"'), "deny");
  execFileSync("git", ["rm", "-q", "--cached", ".env"], { cwd: feat });
  writeFileSync(join(feat, ".env.example"), "SECRET=\n");
  execFileSync("git", ["add", ".env.example"], { cwd: feat });
  assert.equal(bash(feat, 'git commit -m "x"'), "allow");
  assert.equal(bash(feat, "git add -f .env.local"), "deny");
});

test("secret files", () => {
  for (const f of [".env", ".env.local", ".env.stage", ".env.stage.bak", "credentials.json", "keystore.jks"]) {
    assert.equal(run(feat, "Read", { file_path: `/repo/${f}` }), "deny", f);
    assert.equal(bash(feat, `cat ${f}`), "deny", f);
  }
  assert.equal(run(feat, "Read", { file_path: "/repo/.env.example" }), "allow");
  assert.equal(run(feat, "Edit", { file_path: "/repo/src/env.ts" }), "allow");
  assert.equal(bash(feat, "cat .env.example"), "allow");
  assert.equal(bash(feat, "grep -n KEY .env"), "deny");
  assert.equal(bash(feat, "git check-ignore -q .env"), "allow");
  assert.equal(bash(feat, "ls -a | grep env"), "allow");
});

test("production", () => {
  assert.equal(bash(feat, "eas build --platform android --profile preview"), "allow");
  assert.equal(bash(feat, "eas build --platform android --profile production"), "ask");
  assert.equal(bash(feat, "eas submit -p android"), "ask");
  assert.equal(bash(feat, "aws sts get-caller-identity"), "allow");
  assert.equal(bash(feat, "aws codepipeline list-pipeline-executions --pipeline-name x"), "allow");
  assert.equal(bash(feat, "aws ec2 describe-instances --region ap-south-1"), "allow");
  assert.equal(bash(feat, "aws ec2 revoke-security-group-ingress --group-id sg-1"), "ask");
  assert.equal(bash(feat, "aws codepipeline start-pipeline-execution --name the-nura-care-be"), "ask");
  assert.equal(bash(feat, "aws secretsmanager get-secret-value --secret-id nura/api/env"), "deny");
  assert.equal(bash(feat, "vercel --prod"), "ask");
  assert.equal(bash(feat, "npm run build"), "allow");
});
