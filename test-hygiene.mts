// Temporary: hygiene unit checks + one live Apollo match-by-name call to
// validate the new matchPerson params (compares against a known profile).
import fs from "node:fs";

for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
  const m = line.match(/^([A-Z_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
}

const { cleanTitle, nameLooksBroken, repairName } = await import("./src/lib/hygiene");
const { matchPerson } = await import("./src/lib/apollo");

let fails = 0;
function check(label: string, got: unknown, want: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) fails++;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}: ${JSON.stringify(got)}${ok ? "" : " want " + JSON.stringify(want)}`);
}

check("headline pipe", cleanTitle("Incoming Associate @ BCG | James Scholar at UIUC"), "Incoming Associate");
check("plain title", cleanTitle("Talent Sourcing Manager"), "Talent Sourcing Manager");
check("at-company kept (no @)", cleanTitle("Head of Talent at BCG"), "Head of Talent at BCG");
check("null", cleanTitle(null), null);
check("empty after clean", cleanTitle("@ BCG"), null);

check("broken: obfuscated", nameLooksBroken("Keith Be***s"), true);
check("broken: initial", nameLooksBroken("Doris T"), true);
check("broken: single", nameLooksBroken("Cher"), true);
check("healthy", nameLooksBroken("Colton Smith"), false);

check("repair broken", repairName("Doris T", "Doris Tam"), "Doris Tam");
check("no repair healthy", repairName("Colton Smith", "Colton J. Smith"), null);
check("no repair to broken", repairName("Doris T", "Doris T."), null);

if (process.env.LIVE_MATCH === "1") {
  console.log("\n── live: matchPerson by name + company (1 credit) ──");
  const r = await matchPerson({
    firstName: "Colton",
    lastName: "Smith",
    organizationName: "McKinsey & Company",
    domain: "mckinsey.com",
  });
  console.log("matched:", r.person?.name, "|", r.person?.title, "| email:", r.person?.email ? "yes (" + r.person.email.split("@")[1] + ")" : "none");
} else {
  void matchPerson; // verified live 2026-07-06: returns Associate + mckinsey.com email
}

process.exit(fails ? 1 : 0);
