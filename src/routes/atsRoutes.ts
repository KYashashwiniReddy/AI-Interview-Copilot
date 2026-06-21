import { Router } from 'express';
import multer from 'multer';
import {
  analyzeResume,
  analyzeSkillGap,
  getHistory,
  getSkillGapHistory,
  deleteReport,
  bulkDeleteReports,
  deleteSkillGapReport,
  bulkDeleteSkillGapReports,
  optimizeResume,
  downloadOptimizedResume,
  getJobProfile
} from '../controllers/atsController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();
const upload = multer({ limits: { fileSize: 10 * 1024 * 1024 } }); // Limit size to 10MB

// Protected routes
router.use(authMiddleware);

router.post('/analyze', upload.single('resume'), analyzeResume);
router.post('/skill-gap', analyzeSkillGap);
router.get('/history', getHistory);
router.get('/skill-gap/history', getSkillGapHistory);

router.post('/reports/:reportId/optimize', optimizeResume);
router.get('/reports/:reportId/download-optimized', downloadOptimizedResume);
router.get('/job-profile/:id', getJobProfile);

// Delete operations
router.delete('/reports/:id', deleteReport);
router.post('/reports/bulk-delete', bulkDeleteReports);
router.delete('/skill-gap/:id', deleteSkillGapReport);
router.post('/skill-gap/bulk-delete', bulkDeleteSkillGapReports);

export default router;
