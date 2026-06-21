import { Response, NextFunction } from 'express';
import { prisma } from '../lib/prisma';
import { AuthService } from '../services/authService';

const authService = new AuthService();

/**
 * Authentication middleware that verifies JWT and checks user status
 */
export const authMiddleware = async (req: any, res: Response, next: NextFunction): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Access denied. Authorization token missing or malformed.' });
      return;
    }

    const token = authHeader.split(' ')[1];
    
    // Verify Token
    const decoded = authService.verifyToken(token);
    if (!decoded || !decoded.userId) {
      res.status(401).json({ error: 'Access denied. Invalid or expired token.' });
      return;
    }

    // Fetch user context from local DB
    const user = await prisma.user.findUnique({
      where: { id: decoded.userId },
      include: { profile: true }
    });

    if (!user) {
      res.status(401).json({ error: 'Access denied. User record not found.' });
      return;
    }

    if (user.status === 'SUSPENDED') {
      res.status(403).json({ error: 'Your account has been suspended. Please contact support.' });
      return;
    }

    // Attach user to request
    req.user = {
      id: user.id,
      email: user.email,
      role: user.role,
      theme: user.theme,
      fullName: user.profile?.fullName || '',
      avatarUrl: user.profile?.avatarUrl || '',
      hasPassword: !!user.passwordHash,
      createdAt: user.createdAt,
      lastLogin: user.lastLogin
    };

    next();
  } catch (error: any) {
    console.error('Auth middleware validation error:', error);
    res.status(401).json({ error: error.message || 'Authentication failed. Please sign in again.' });
  }
};

/**
 * Role middleware: Restricts routes to Admin users only
 */
export const adminMiddleware = (req: any, res: Response, next: NextFunction): void => {
  if (!req.user || (req.user.role || '').toUpperCase() !== 'ADMIN') {
    res.status(403).json({ error: 'Forbidden. Access restricted to administrator accounts.' });
    return;
  }
  next();
};
