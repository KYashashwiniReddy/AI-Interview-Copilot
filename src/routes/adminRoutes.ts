import { Router } from 'express';
import {
  getStats,
  listUsers,
  updateUserRole,
  updateUserStatus,
  deleteUser,
  getUserReports,
  getUserActivity,
  getAnalytics,
  resetUserPassword,
  getSettings,
  updateSettings,
  getAuditLogs,
  getAiMonitoring,
  addAdmin,
  removeAdmin,
  listQuestions,
  createQuestion,
  updateQuestion,
  deleteQuestion,
  generateAIQuestions,
  bulkSaveQuestions
} from '../controllers/adminController';
import { authMiddleware, adminMiddleware } from '../middleware/authMiddleware';

const router = Router();

// Apply auth and admin restrictions globally to admin routes
router.use(authMiddleware);
router.use(adminMiddleware);

router.get('/stats', getStats);
router.get('/users', listUsers);
router.put('/users/:id/role', updateUserRole);
router.put('/users/:id/status', updateUserStatus);
router.delete('/users/:id', deleteUser);
router.put('/users/:id/reset-password', resetUserPassword);
router.get('/users/:id/reports', getUserReports);
router.get('/users/:id/activity', getUserActivity);

// Question Bank Routes
router.get('/questions', listQuestions);
router.post('/questions', createQuestion);
router.put('/questions/:id', updateQuestion);
router.delete('/questions/:id', deleteQuestion);
router.post('/questions/generate', generateAIQuestions);
router.post('/questions/bulk-save', bulkSaveQuestions);

router.get('/settings', getSettings);
router.put('/settings', updateSettings);
router.get('/audit-logs', getAuditLogs);
router.get('/ai-monitoring', getAiMonitoring);
router.post('/admins', addAdmin);
router.delete('/admins/:id', removeAdmin);

router.get('/analytics', getAnalytics);

export default router;
