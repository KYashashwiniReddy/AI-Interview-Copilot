import { Router } from 'express';
import multer from 'multer';
import {
  register,
  verifyOtp,
  login,
  oauthLogin,
  getCurrentUser,
  getDashboardData,
  updateTheme,
  updateProfile,
  uploadAvatar,
  changePassword,
  forgotPassword,
  resetPassword,
  deleteAccount,
  clearAllHistory
} from '../controllers/authController';
import { authMiddleware } from '../middleware/authMiddleware';

const router = Router();
const upload = multer({ limits: { fileSize: 5 * 1024 * 1024 } }); // Limit to 5MB

router.post('/register', register);
router.post('/verify-otp', verifyOtp);
router.post('/login', login);
router.post('/oauth', oauthLogin);
router.get('/me', authMiddleware, getCurrentUser);
router.get('/dashboard', authMiddleware, getDashboardData);
router.put('/theme', authMiddleware, updateTheme);

// Account Settings, Password Recovery & Deletion
router.put('/profile', authMiddleware, updateProfile);
router.post('/upload-avatar', authMiddleware, upload.single('avatar'), uploadAvatar);
router.put('/change-password', authMiddleware, changePassword);
router.post('/forgot-password', forgotPassword);
router.post('/reset-password', resetPassword);
router.delete('/delete-account', authMiddleware, deleteAccount);
router.delete('/clear-all-history', authMiddleware, clearAllHistory);

export default router;
