import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import jwt, { Secret, SignOptions } from 'jsonwebtoken';

import { getSecret } from '../config/secrets.js';
import { AuthError, DatabaseError, ValidationError } from '../db/errors.js';
import { db } from '../db/index.js';
import { users } from '../db/schema.js';
import { GoogleUserProfile, JwtPayload, NewUserWithHashedPassword, User } from '../types/user.js';

const SALT_ROUNDS = 10;

export class AuthService {
  private getJwtSecret(): Secret {
    return getSecret('JWT_SECRET') as Secret;
  }

  private getJwtExpiresIn(): string {
    return getSecret('JWT_EXPIRES_IN');
  }

  public async registerUser(payload: {
    email: string;
    password?: string;
    name?: string | null;
    role?: string;
  }): Promise<Omit<User, 'hashedPassword'>> {
    const { email, password, name, role } = payload;
    if (!email || !password) {
      throw new ValidationError('Email and password are required for registration.');
    }
    if (password.length < 6) {
      throw new ValidationError('Password must be at least 6 characters long.');
    }

    const [existingUser] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);
    if (existingUser) {
      throw new ValidationError('User with this email already exists.');
    }

    const hashedPassword = await bcrypt.hash(password, SALT_ROUNDS);

    try {
      const userData: NewUserWithHashedPassword = {
        email,
        hashedPassword,
        name: name || null,
        role: role || 'user'
      };
      const [newUserRecord] = await db.insert(users).values(userData).returning();

      if (!newUserRecord) {
        throw new DatabaseError('Failed to create user after registration.');
      }
      const { hashedPassword: _, ...userWithoutPassword } = newUserRecord;
      return userWithoutPassword;
    } catch (error: any) {
      console.error('Error during user registration in service:', error);
      if (error.code === '23505') {
        throw new ValidationError('User with this email already exists.');
      }
      throw new DatabaseError('User registration failed.', error);
    }
  }

  public async loginUser(
    email: string,
    passwordPlainText: string
  ): Promise<{ token: string; user: Omit<User, 'hashedPassword' | 'createdAt' | 'updatedAt'> }> {
    if (!email || !passwordPlainText) {
      throw new ValidationError('Email and password are required for login.');
    }

    const [user] = await db
      .select({
        id: users.id,
        email: users.email,
        name: users.name,
        hashedPassword: users.hashedPassword,
        role: users.role
      })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    if (!user || !user.hashedPassword) {
      throw new AuthError('Invalid email or password.');
    }

    const isPasswordValid = await bcrypt.compare(passwordPlainText, user.hashedPassword);
    if (!isPasswordValid) {
      throw new AuthError('Invalid email or password.');
    }

    const userForToken: JwtPayload = {
      id: user.id,
      email: user.email,
      role: user.role,
      name: user.name
    };
    const token = this.generateToken(userForToken);

    const { hashedPassword: _h, ...userToReturn } = user;

    return { token, user: userToReturn };
  }

  public generateToken(payload: JwtPayload): string {
    const options: SignOptions = {
      expiresIn: this.getJwtExpiresIn() as any
    };
    const tokenPayload = {
      id: payload.id,
      email: payload.email,
      role: payload.role,
      name: payload.name
    };
    return jwt.sign(tokenPayload, this.getJwtSecret(), options);
  }

  public verifyToken(token: string): JwtPayload | null {
    try {
      const decoded = jwt.verify(token, this.getJwtSecret()) as JwtPayload;
      return decoded;
    } catch (error) {
      console.warn('JWT verification failed:', error);
      return null;
    }
  }

  /**
   * Authenticates a user via Google OAuth profile
   * This method handles both existing users and new user creation
   */
  public async authenticateGoogleUser(googleProfile: GoogleUserProfile): Promise<{
    token: string;
    user: Omit<User, 'hashedPassword' | 'createdAt' | 'updatedAt'>;
    isNewUser: boolean;
  }> {
    console.log(
      'AuthService.authenticateGoogleUser - Processing Google user:',
      googleProfile.email
    );

    try {
      // Step 1: Check if user already exists by email
      const [existingUser] = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          hashedPassword: users.hashedPassword
        })
        .from(users)
        .where(eq(users.email, googleProfile.email))
        .limit(1);

      if (existingUser) {
        console.log('AuthService.authenticateGoogleUser - Existing user found:', existingUser.id);

        if (existingUser.hashedPassword) {
          throw new AuthError(
            'An account with this email already exists with password authentication. Please log in with your password or contact support to link your Google account.'
          );
        }

        const userForToken: JwtPayload = {
          id: existingUser.id,
          email: existingUser.email,
          role: existingUser.role,
          name: existingUser.name
        };

        const token = this.generateToken(userForToken);
        const { hashedPassword: _h, ...userToReturn } = existingUser;

        return { token, user: userToReturn, isNewUser: false };
      }

      // Step 2: Create new user from Google profile
      console.log('AuthService.authenticateGoogleUser - Creating new user from Google profile');

      const userData: NewUserWithHashedPassword = {
        email: googleProfile.email,
        hashedPassword: '',
        name: googleProfile.name,
        role: 'user'
      };

      const [newUserRecord] = await db.insert(users).values(userData).returning();

      if (!newUserRecord) {
        throw new DatabaseError('Failed to create user from Google profile.');
      }

      console.log('AuthService.authenticateGoogleUser - New user created:', newUserRecord.id);

      // Step 3: Generate token for new user
      const userForToken: JwtPayload = {
        id: newUserRecord.id,
        email: newUserRecord.email,
        role: newUserRecord.role,
        name: newUserRecord.name
      };

      const token = this.generateToken(userForToken);
      const { hashedPassword: _h, ...userToReturn } = newUserRecord;

      return { token, user: userToReturn, isNewUser: true };
    } catch (error: any) {
      console.error('AuthService.authenticateGoogleUser - Error:', error.message);

      if (error instanceof AuthError || error instanceof ValidationError) {
        throw error;
      }

      if (error.code === '23505') {
        throw new ValidationError('User with this email already exists.');
      }

      throw new DatabaseError('Google authentication failed.', error);
    }
  }

  /**
   * Checks if a user exists by email (for Google OAuth flow)
   */
  public async findUserByEmail(email: string): Promise<Omit<User, 'hashedPassword'> | null> {
    try {
      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          name: users.name,
          role: users.role,
          createdAt: users.createdAt,
          updatedAt: users.updatedAt
        })
        .from(users)
        .where(eq(users.email, email))
        .limit(1);

      return user || null;
    } catch (error: any) {
      console.error('AuthService.findUserByEmail - Error:', error.message);
      throw new DatabaseError('Failed to find user by email.', error);
    }
  }
}
