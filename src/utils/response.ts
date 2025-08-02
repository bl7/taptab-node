import { Response } from 'express';

export interface ApiResponse {
  success: boolean;
  data?: any;
  message?: string;
  error?: {
    code: string;
    message: string;
    details?: any;
  };
  timestamp: string;
}

export const sendSuccess = (res: Response, data?: any, message?: string, status = 200) => {
  const response: ApiResponse = {
    success: true,
    data,
    message,
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(response);
};

export const sendError = (res: Response, code: string, message: string, status = 500, details?: any) => {
  const response: ApiResponse = {
    success: false,
    error: {
      code,
      message,
      details,
    },
    timestamp: new Date().toISOString(),
  };
  res.status(status).json(response);
};

export const sendNotFound = (res: Response, message = 'Resource not found') => {
  sendError(res, 'NOT_FOUND', message, 404);
}; 