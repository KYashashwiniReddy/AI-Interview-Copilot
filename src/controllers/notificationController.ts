import { Response } from 'express';
import { prisma } from '../lib/prisma';

export const getNotifications = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;

    const notifications = await prisma.notification.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' }
    });

    res.status(200).json({ notifications });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to retrieve notifications.' });
  }
};

export const markAsRead = async (req: any, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const userId = req.user.id;

    const notification = await prisma.notification.updateMany({
      where: { id, userId },
      data: { isRead: true }
    });

    res.status(200).json({ message: 'Notification marked as read.' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update notification status.' });
  }
};

export const markAllAsRead = async (req: any, res: Response): Promise<void> => {
  try {
    const userId = req.user.id;

    await prisma.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true }
    });

    res.status(200).json({ message: 'All notifications marked as read.' });
  } catch (error: any) {
    res.status(500).json({ error: 'Failed to update notifications.' });
  }
};
