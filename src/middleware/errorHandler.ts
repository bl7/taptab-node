import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

export interface AppError extends Error {
  statusCode?: number;
  isOperational?: boolean;
}

export const errorHandler = (
  err: AppError,
  req: Request,
  res: Response,
  _next: NextFunction
) => {
  const statusCode = err.statusCode || 500;
  const message = err.message || "Internal Server Error";

  // Log error
  logger.error(
    `${statusCode} - ${message} - ${req.originalUrl} - ${req.method} - ${req.ip}`
  );

  // Don't leak error details in production
  const errorResponse = {
    success: false,
    error: {
      code: (err as any).code || "INTERNAL_ERROR",
      message:
        process.env["NODE_ENV"] === "production" && statusCode === 500
          ? "Internal server error"
          : err.message || "An error occurred",
    },
    timestamp: new Date().toISOString(),
    ...(process.env["NODE_ENV"] === "development" && { stack: err.stack }),
  };

  res.status(statusCode).json(errorResponse);
};
