import { Router } from 'express';
import {
  generateRoadmap,
  getRoadmaps,
  getRoadmapById,
  deleteRoadmap,
  bulkDeleteRoadmaps,
  toggleRoadmapStatus,
  updateRoadmapStatus,
  updateRoadmapProgress,
  downloadRoadmap,
  getTopicExplanation,
  submitProject,
  addProjectToResume
} from '../controllers/roadmapController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();

router.use(authMiddleware);

router.post('/generate', generateRoadmap);
router.get('/', getRoadmaps);
router.get('/:id', getRoadmapById);
router.get('/:id/download', downloadRoadmap);

// Learning topic details
router.get('/:id/topics/:topicName', getTopicExplanation);

// Project operations
router.post('/:id/projects/:week/submit', submitProject);
router.post('/:id/projects/:week/add-to-resume', addProjectToResume);

// Delete operations
router.delete('/:id', deleteRoadmap);
router.post('/bulk-delete', bulkDeleteRoadmaps);
router.put('/:id/toggle-status', toggleRoadmapStatus);
router.put('/:id/status', updateRoadmapStatus);
router.put('/:id/progress', updateRoadmapProgress);

export default router;
