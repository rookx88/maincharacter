// src/utils/errorHandler.ts
import { Response } from 'express';

export class AppError extends Error {
  constructor(
    public message: string,
    public statusCode: number = 500,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }
}

export const handleError = (res: Response, error: unknown) => {
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({ 
      error: error.message,
      code: error.code,
      details: error.details
    });
  }
  
  const message = error instanceof Error ? error.message : 'Unknown error';
  return res.status(500).json({ error: message });
};