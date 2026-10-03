/*
  Phase 5.0 — Pharmacy demand forecast engine.

  Adds the index that serves the forecast engine's single aggregation query:

      SELECT oi.product_id,
             to_char(o.created_at, 'YYYY-MM-DD'),
             SUM(oi.quantity),
             COUNT(DISTINCT o.id)
      FROM order_items oi
      JOIN orders o ON o.id = oi.order_id
      WHERE o.status = 'DELIVERED'
        AND o.created_at >= $1
        AND o.created_at <  $2
      GROUP BY 1, 2

  The existing indexes cover orders(status) and orders(patient_id) separately,
  so the planner could only seek on status and then filter an unbounded
  created_at range before joining order_items. The composite index makes the
  status equality AND the created_at range a single index scan, which is the
  actual access pattern for every forecast request (summary, product list,
  single-product detail, and backtest).

  The pre-existing single-column orders(status) index is intentionally left in
  place: it is redundant as a prefix of this one, but dropping it would be a
  change beyond this phase's scope and could alter plans of queries outside the
  forecast engine.

  Index-only change: no data is added, removed, or rewritten, and no column or
  constraint is modified. Safe to apply to a live database.
*/

-- DropIndex is a no-op if the index does not exist yet (fresh databases).
DROP INDEX IF EXISTS "orders_status_created_at_idx";
CREATE INDEX "orders_status_created_at_idx" ON "orders"("status", "created_at");
