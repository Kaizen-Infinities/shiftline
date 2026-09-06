import { Router } from 'express';
import { CustomerTypeController } from './customer-type.controller';
;
import { createCustomerTypeSchema, updateCustomerTypeSchema, customerTypeIdSchema } from './customer-type.validation';
import { asyncHandler } from '../../utils/asyncHandler';
import { validateMiddleware } from '../../middleware/validate.middleware';

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";

const router = Router();
router.use(authMiddleware);

router.get('/', requirePermission("customer-types.view"), asyncHandler(CustomerTypeController.getAll));
router.get('/:id', requirePermission("customer-types.view"), validateMiddleware(customerTypeIdSchema), asyncHandler(CustomerTypeController.getById));
router.post('/', requirePermission("customer-types.create"), validateMiddleware(createCustomerTypeSchema), asyncHandler(CustomerTypeController.create));
router.put('/:id', requirePermission("customer-types.edit"), validateMiddleware(updateCustomerTypeSchema), asyncHandler(CustomerTypeController.update));
router.delete('/:id', requirePermission("customer-types.delete"), validateMiddleware(customerTypeIdSchema), asyncHandler(CustomerTypeController.delete));

export default router;
