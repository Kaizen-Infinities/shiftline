import { Router } from 'express';
import { CustomerGradeController } from './customer-grade.controller';
import { createCustomerGradeSchema, updateCustomerGradeSchema, customerGradeIdSchema } from './customer-grade.validation';
import { asyncHandler } from '../../utils/asyncHandler';
import { validateMiddleware } from '../../middleware/validate.middleware';

import { authMiddleware } from "../../middleware/auth.middleware";
import { requirePermission } from "../../middleware/permission.middleware";

const router = Router();
router.use(authMiddleware);

router.get('/', requirePermission("customer-grades.view"), asyncHandler(CustomerGradeController.getAll));
router.get('/:id', requirePermission("customer-grades.view"), validateMiddleware(customerGradeIdSchema), asyncHandler(CustomerGradeController.getById));
router.post('/', requirePermission("customer-grades.create"), validateMiddleware(createCustomerGradeSchema), asyncHandler(CustomerGradeController.create));
router.put('/:id', requirePermission("customer-grades.edit"), validateMiddleware(updateCustomerGradeSchema), asyncHandler(CustomerGradeController.update));
router.delete('/:id', requirePermission("customer-grades.delete"), validateMiddleware(customerGradeIdSchema), asyncHandler(CustomerGradeController.delete));

export default router;
