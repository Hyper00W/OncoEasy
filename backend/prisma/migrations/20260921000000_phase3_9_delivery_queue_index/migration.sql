/*
  Phase 3.9 — Production database readiness.

  Adds the delivery queue index used by the admin/Ops delivery list:

      prisma.delivery.findMany({
        where: { status?, mode? },
        orderBy: [{ createdAt: "desc" }, { id: "desc" }]
      })

  The previous index set only covered agentId; filtered queues scanned
  deliveries by status/mode before sorting by createdAt. Non-concurrent
  CREATE INDEX is acceptable here: deliveries is append-mostly and small
  at this stage of the product; the table lock is brief.

  Index-only change: no data is added, removed, or rewritten.
*/

-- DropIndex is a no-op if the index does not exist yet (fresh databases).
DROP INDEX IF EXISTS "deliveries_status_mode_created_at_idx";
CREATE INDEX "deliveries_status_mode_created_at_idx" ON "deliveries"("status", "mode", "created_at");
