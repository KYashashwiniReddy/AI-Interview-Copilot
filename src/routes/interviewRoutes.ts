import { Router } from 'express';
import multer from 'multer';
import {
  startSession,
  submitAnswer,
  completeSession,
  getHistory,
  getReport,
  deleteSession,
  bulkDeleteSessions,
  downloadReport,
  getPublicReport
} from '../controllers/interviewController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();
const upload = multer({ limits: { fileSize: 50 * 1024 * 1024 } }); // Limit size to 50MB for audio/video uploads

// Public endpoints
router.get('/public/report/:sessionId', getPublicReport);

// Protected endpoints
router.use(authMiddleware);

router.post('/start', startSession);
router.post('/:sessionId/answer', upload.fields([{ name: 'voice', maxCount: 1 }, { name: 'video', maxCount: 1 }]), submitAnswer);
router.post('/:sessionId/complete', completeSession);
router.get('/history', getHistory);
router.get('/:sessionId/report', getReport);
router.get('/:sessionId/download', downloadReport);

// Delete operations
router.delete('/sessions/:id', deleteSession);
router.post('/sessions/bulk-delete', bulkDeleteSessions);

export default router;
