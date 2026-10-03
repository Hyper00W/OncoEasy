/**
 * One-off cleanup: remove QA / demo lab-test rows that leaked into the catalog
 * (e.g. "phase148-1790225697976 Panel", "Dashboard regression test panel").
 *
 * Matching rules — deliberately narrow so a real test can never be caught:
 *   1. Names starting with "phase" followed by digits and ending in "Panel"
 *   2. Names containing "regression test" (case-insensitive)
 *
 * Soft-delete only (isActive = false) so the change is reversible and any
 * historical lab bookings keep their referential integrity. The list API
 * already filters isActive: true, so hidden rows disappear from the UI.
 *
 * Usage:  npx tsx scripts/cleanup-lab-tests.ts            (dry run)
 *         npx tsx scripts/cleanup-lab-tests.ts --apply    (deactivate)
 *         npx tsx scripts/cleanup-lab-tests.ts --restore  (undo)
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const phasePanelPattern = /^phase\d+.*panel$/i;
const regressionPattern = /regression test/i;

function isJunk(name: string): boolean {
  return phasePanelPattern.test(name.trim()) || regressionPattern.test(name.trim());
}

async function main(): Promise<void> {
  const mode = process.argv.includes("--apply") ? "apply" : process.argv.includes("--restore") ? "restore" : "dry-run";

  const tests = await prisma.labTest.findMany({
    select: { id: true, name: true, category: true, isActive: true }
  });

  const junk = tests.filter((test) => isJunk(test.name));
  const junkInactive = junk.filter((test) => !test.isActive);

  console.log(`Total lab tests: ${tests.length}`);
  console.log(`Matching junk rows: ${junk.length} (${junkInactive.length} already inactive)\n`);
  for (const test of junk) {
    console.log(`  - ${test.name} | ${test.category} | active=${test.isActive}`);
  }

  if (junk.length === 0) {
    console.log("\nNothing to do.");
    return;
  }

  if (mode === "dry-run") {
    console.log(`\nDry run — re-run with --apply to deactivate these ${junk.length} rows (or --restore to reactivate).`);
    return;
  }

  const ids = junk.map((test) => test.id);
  const result = await prisma.labTest.updateMany({
    where: { id: { in: ids } },
    data: { isActive: mode === "apply" ? false : true }
  });

  console.log(`\n${mode === "apply" ? "Deactivated" : "Restored"} ${result.count} lab test(s).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
