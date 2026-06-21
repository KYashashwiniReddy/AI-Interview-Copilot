import { Router, Response } from 'express';
import { AIService } from '../services/aiService';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();
const aiService = new AIService();

// Generate standard JD for selected role
router.post('/generate-jd', authMiddleware, async (req: any, res: Response) => {
  try {
    const { role } = req.body;
    if (!role) {
      res.status(400).json({ error: 'Role name is required.' });
      return;
    }

    const jdData = await aiService.generateJobDescription(role);
    res.status(200).json({ role, jobDescription: jdData });
  } catch (error: any) {
    console.error('Job Description Generation Error:', error);
    res.status(500).json({ error: error.message || 'Failed to generate job description.' });
  }
});

export default router;
