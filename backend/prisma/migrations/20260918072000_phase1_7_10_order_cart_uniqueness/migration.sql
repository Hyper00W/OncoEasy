-- Enforce one order association for each converted cart while allowing
-- future orders that do not originate from a cart.
DROP INDEX "orders_cart_id_idx";
CREATE UNIQUE INDEX "orders_cart_id_key" ON "orders"("cart_id");