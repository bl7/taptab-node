import { Router } from "express";
import basicOperations from "./basic-operations";
import orderModifications from "./order-modifications";
import paymentOperations from "./payment-operations";
import mergeOperations from "./merge-operations";
import tableOperations from "./table-operations";
import splitOperations from "./split-operations";

const router = Router();

// ==================== ORDERS MANAGEMENT ====================

// Mount all order operation modules
router.use("/", basicOperations); // GET /, POST /, PUT /:id, PUT /:id/items/:itemId, DELETE /:id
router.use("/", orderModifications); // PUT /:id/modify, PUT /:id/modify/batch
router.use("/", paymentOperations); // PUT /:id/pay
router.use("/", mergeOperations); // POST /validate-merge, POST /merge
router.use("/", tableOperations); // PUT /:id/move-table
router.use("/", splitOperations); // POST /:id/split

export default router;
