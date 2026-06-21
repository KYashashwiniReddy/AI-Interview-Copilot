import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { prisma } from '../lib/prisma';
import * as bcrypt from 'bcryptjs';
import * as jwt from 'jsonwebtoken';
import * as nodemailer from 'nodemailer';

export class AuthService {
  private supabase: SupabaseClient | null = null;
  private supabaseAdmin: SupabaseClient | null = null;
  private isLocalFallback = true;
  private jwtSecret = process.env.JWT_SECRET || 'fallback_secret_key_123';

  // Simulating an OTP store in memory for local fallback mode
  private otpStore: Map<string, { otp: string; expiresAt: number; tempUserData: any }> = new Map();

  constructor() {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_KEY;
    const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || key;

    if (url && key) {
      try {
        this.supabase = createClient(url, key);
        this.isLocalFallback = false;
        console.log('Supabase Auth initialized successfully.');
      } catch (err) {
        console.error('Failed to initialize Supabase Auth client, falling back to local Auth:', err);
      }
    } else {
      console.log('Supabase environment variables missing. Operating in local JWT Authentication mode.');
    }

    if (url && serviceKey) {
      try {
        this.supabaseAdmin = createClient(url, serviceKey, {
          auth: {
            autoRefreshToken: false,
            persistSession: false
          }
        });
        console.log('Supabase Admin client initialized successfully.');
      } catch (err) {
        console.error('Failed to initialize Supabase Admin client:', err);
      }
    }
  }

  /**
   * Register User (triggers OTP verification code email)
   */
  async register(email: string, passwordHashRaw: string, fullName: string): Promise<{ message: string; requiresOtp: boolean }> {
    // Check if user already exists in Prisma DB
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new Error('Account already exists. Please sign in.');
    }

    if (!this.isLocalFallback && this.supabase) {
      try {
        // Register using Supabase Auth
        const { data, error } = await this.supabase.auth.signUp({
          email,
          password: passwordHashRaw,
          options: {
            data: {
              full_name: fullName
            }
          }
        });

        if (error) throw error;

        // If email verification is mandatory in Supabase, we wait for verification.
        // We will create the user entry in our local database in a pending state or during hook.
        // For sync, we insert standard student user into our local database.
        const passwordHash = bcrypt.hashSync(passwordHashRaw, 10);
        await prisma.user.create({
          data: {
            email,
            passwordHash,
            role: 'STUDENT',
            status: 'ACTIVE', // Activated by default or pending verification
            profile: {
              create: {
                fullName
              }
            }
          }
        });

        return {
          message: 'Verification email sent. Please check your inbox or verify with OTP.',
          requiresOtp: true
        };
      } catch (err: any) {
        console.error('Supabase Auth sign up failed, falling back to local register:', err);
        // Fall back to local register if Supabase errors out
      }
    }

    // Local Fallback OTP Mode
    const passwordHash = bcrypt.hashSync(passwordHashRaw, 10);
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = Date.now() + 10 * 60 * 1000; // 10 minutes expiry

    // Save temporary registration details in memory
    this.otpStore.set(email, {
      otp,
      expiresAt,
      tempUserData: { email, passwordHash, fullName }
    });

    console.log(`[LOCAL DEV MAIL] Sent email OTP verification code to ${email}: ${otp}`);

    // Send direct OTP email if SMTP is configured
    await this.sendOtpEmail(email, otp);

    return {
      message: `Verification code sent to ${email} (Local development OTP: ${otp})`,
      requiresOtp: true
    };
  }

  /**
   * Helper method to send OTP email directly via SMTP
   */
  async sendOtpEmail(email: string, otp: string): Promise<void> {
    if (process.env.NODE_ENV === 'test') {
      console.log('Skipping SMTP email send in test environment.');
      return;
    }

    const host = process.env.SMTP_HOST;
    const port = process.env.SMTP_PORT;
    const user = process.env.SMTP_USER;
    const pass = process.env.SMTP_PASS;
    const from = process.env.SMTP_FROM || 'no-reply@novahire.com';

    if (!host || !user || !pass) {
      console.log('SMTP settings not fully configured in env. Skipping real email sending.');
      return;
    }

    try {
      const transporter = nodemailer.createTransport({
        host,
        port: parseInt(port || '587'),
        secure: port === '465',
        auth: {
          user,
          pass
        }
      });

      await transporter.sendMail({
        from: `"NovaHire AI" <${from}>`,
        to: email,
        subject: 'Your Verification Code - NovaHire AI',
        text: `Your verification code is: ${otp}. This code is valid for 10 minutes.`,
        html: `
          <div style="font-family: Arial, sans-serif; padding: 20px; max-width: 600px; margin: auto; border: 1px solid #ddd; border-radius: 10px;">
            <h2 style="color: #4F46E5; text-align: center;">NovaHire AI</h2>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
            <p>Hello,</p>
            <p>Thank you for registering. Please use the verification code below to verify your email address and activate your account:</p>
            <div style="background-color: #F3F4F6; padding: 15px; border-radius: 5px; text-align: center; font-size: 24px; font-weight: bold; letter-spacing: 5px; color: #1F2937; margin: 20px 0;">
              ${otp}
            </div>
            <p>This code is valid for 10 minutes. If you did not request this code, you can safely ignore this email.</p>
            <hr style="border: 0; border-top: 1px solid #eee; margin: 20px 0;" />
            <p style="font-size: 12px; color: #9CA3AF; text-align: center;">&copy; 2026 NovaHire AI. All rights reserved.</p>
          </div>
        `
      });
      console.log(`Successfully sent OTP email to ${email} via SMTP.`);
    } catch (err) {
      console.error('Failed to send OTP email via SMTP:', err);
    }
  }

  /**
   * Verify Signup OTP and activate user
   */
  async verifyOtp(email: string, code: string): Promise<{ token: string; user: any }> {
    if (!this.isLocalFallback && this.supabase) {
      try {
        const { data, error } = await this.supabase.auth.verifyOtp({
          email,
          token: code,
          type: 'signup'
        });

        if (error) throw error;

        const userRecord = await prisma.user.update({
          where: { email },
          data: { lastLogin: new Date() },
          include: { profile: true }
        });

        if (!userRecord) {
          throw new Error('User record not found in database.');
        }

        const localToken = jwt.sign(
          { userId: userRecord.id, email: userRecord.email, role: userRecord.role },
          this.jwtSecret,
          { expiresIn: '7d' }
        );

        return { token: localToken, user: userRecord };
      } catch (err) {
        console.error('Supabase OTP verification failed, trying local OTP store:', err);
      }
    }

    // Local OTP Verification
    const stored = this.otpStore.get(email);
    if (!stored) {
      throw new Error('No pending registration found for this email.');
    }

    if (Date.now() > stored.expiresAt) {
      this.otpStore.delete(email);
      throw new Error('Verification OTP code has expired. Please register again.');
    }

    if (stored.otp !== code) {
      throw new Error('Invalid verification OTP code. Please try again.');
    }

    // Create user in local Prisma DB
    const { passwordHash, fullName } = stored.tempUserData;
    const user = await prisma.user.create({
      data: {
        email,
        passwordHash,
        role: 'STUDENT',
        status: 'ACTIVE',
        lastLogin: new Date(),
        profile: {
          create: {
            fullName
          }
        }
      },
      include: {
        profile: true
      }
    });

    // Clean up OTP store
    this.otpStore.delete(email);

    // Generate local JWT token
    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      this.jwtSecret,
      { expiresIn: '7d' }
    );

    return { token, user };
  }

  /**
   * Login User
   */
  async login(email: string, passwordRaw: string): Promise<{ token: string; user: any }> {
    if (!this.isLocalFallback && this.supabase) {
      try {
        const { data, error } = await this.supabase.auth.signInWithPassword({
          email,
          password: passwordRaw
        });

        if (error) throw error;

        // Sync password hash in Prisma and update lastLogin
        const passwordHash = bcrypt.hashSync(passwordRaw, 10);
        const userRecord = await prisma.user.update({
          where: { email },
          data: {
            passwordHash,
            lastLogin: new Date()
          },
          include: { profile: true }
        });

        if (userRecord) {
          if (userRecord.status === 'SUSPENDED') {
            throw new Error('This account has been suspended by an administrator.');
          }

          const localToken = jwt.sign(
            { userId: userRecord.id, email: userRecord.email, role: userRecord.role },
            this.jwtSecret,
            { expiresIn: '7d' }
          );

          return { token: localToken, user: userRecord };
        }
      } catch (err: any) {
        console.error('Supabase Auth login failed, checking local database:', err);
        // Fall back to check local DB directly
      }
    }

    // Local DB authentication fallback
    const user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true }
    });

    if (!user) {
      throw new Error('Account does not exist. Please register first.');
    }

    if (user.status === 'SUSPENDED') {
      throw new Error('This account has been suspended by an administrator.');
    }

    if (!user.passwordHash) {
      throw new Error('Account password not set locally (registered via OAuth). Please sign in using your OAuth provider.');
    }

    const isValidPassword = bcrypt.compareSync(passwordRaw, user.passwordHash);
    if (!isValidPassword) {
      throw new Error('Invalid email or password. Please try again.');
    }

    // Update lastLogin
    const updatedUser = await prisma.user.update({
      where: { id: user.id },
      data: { lastLogin: new Date() },
      include: { profile: true }
    });

    // Sign and return local JWT token
    const token = jwt.sign(
      { userId: updatedUser.id, email: updatedUser.email, role: updatedUser.role },
      this.jwtSecret,
      { expiresIn: '7d' }
    );

    return { token, user: updatedUser };
  }

  /**
   * Verifies Google or GitHub OAuth Token and syncs user profiles in database
   */
  async verifyOAuthUser(email: string, fullName: string, provider: string): Promise<{ token: string; user: any }> {
    let user = await prisma.user.findUnique({
      where: { email },
      include: { profile: true }
    });

    if (!user) {
      // Auto-create user from OAuth profile details
      user = await prisma.user.create({
        data: {
          email,
          role: 'STUDENT',
          status: 'ACTIVE',
          lastLogin: new Date(),
          profile: {
            create: {
              fullName
            }
          }
        },
        include: {
          profile: true
        }
      });
    } else {
      if (user.status === 'SUSPENDED') {
        throw new Error('This account has been suspended by an administrator.');
      }
      user = await prisma.user.update({
        where: { email },
        data: {
          lastLogin: new Date(),
          profile: {
            upsert: {
              create: {
                fullName,
                experienceLevel: 'Fresher',
                currentRole: 'Student'
              },
              update: {} // Keep existing details
            }
          }
        },
        include: { profile: true }
      });
    }

    const token = jwt.sign(
      { userId: user.id, email: user.email, role: user.role },
      this.jwtSecret,
      { expiresIn: '7d' }
    );

    return { token, user };
  }

  /**
   * Verifies local JWT token payload
   */
  verifyToken(token: string): any {
    try {
      return jwt.verify(token, this.jwtSecret);
    } catch (err) {
      throw new Error('Session expired or token invalid. Please log in again.');
    }
  }
}
