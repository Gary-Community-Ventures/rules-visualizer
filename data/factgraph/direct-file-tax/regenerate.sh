#!/usr/bin/env bash
# Re-aggregate eligibility.xml from a fresh clone of IRS-Public/direct-file.
# Run from repo root. Requires vendor/direct-file/ checked out (clone via
# `git clone --depth 1 https://github.com/IRS-Public/direct-file.git
# vendor/direct-file`).
set -euo pipefail
cd "$(dirname "$0")/../../.."

python3 - <<'PY'
import os, re
TAX_DIR = "vendor/direct-file/direct-file/backend/src/main/resources/tax"
OUT = "data/factgraph/direct-file-tax/eligibility.xml"

# Skipped: files that use the <IndexOf><Collection>…</Collection><Index>…</Index></IndexOf>
# shape that factgraph-rs doesn't yet parse. See README.md for details.
SKIP = {"dependentsBenefitSplit.xml", "familyAndHousehold.xml", "formW2s.xml"}

facts = []
for fn in sorted(os.listdir(TAX_DIR)):
    if not fn.endswith(".xml") or fn in SKIP: continue
    with open(os.path.join(TAX_DIR, fn)) as f: text = f.read()
    m = re.search(r"<Facts>(.*?)</Facts>", text, re.DOTALL)
    if not m: continue
    inner = m.group(1).strip()
    if inner: facts.append(f"  <!-- ===== from {fn} ===== -->\n{inner}")

merged = "<FactDictionaryModule>\n  <Facts>\n" + "\n".join(facts) + "\n  </Facts>\n</FactDictionaryModule>\n"
with open(OUT, "w") as f: f.write(merged)
count = len(re.findall(r"<Fact ", merged))
print(f"wrote {OUT}: {count} facts, {os.path.getsize(OUT) // 1024}KB")
PY
