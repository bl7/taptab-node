import { logger } from "../utils/logger";

export interface NotificationData {
  type: "sms" | "email" | "push" | "in_app";
  recipient: string;
  subject?: string;
  message: string;
  tenantId: string;
  metadata?: Record<string, any>;
}

export interface SMSNotificationData {
  to: string;
  message: string;
  tenantId: string;
  metadata?: Record<string, any>;
}

export interface EmailNotificationData {
  to: string;
  subject: string;
  body: string;
  tenantId: string;
  isHTML?: boolean;
  metadata?: Record<string, any>;
  attachments?: Array<{
    filename: string;
    content: string | Buffer;
    contentType: string;
  }>;
}

export interface PushNotificationData {
  userId: string;
  title: string;
  body: string;
  tenantId: string;
  data?: Record<string, any>;
  badge?: number;
  sound?: string;
}

export class NotificationService {
  /**
   * Send SMS notification
   */
  static async sendSMS(smsData: SMSNotificationData): Promise<boolean> {
    try {
      const { to, message, tenantId, metadata } = smsData;

      // Validate phone number
      if (!this.isValidPhoneNumber(to)) {
        throw new Error("Invalid phone number format");
      }

      // Check if Twilio is configured
      if (
        !process.env["TWILIO_ACCOUNT_SID"] ||
        !process.env["TWILIO_AUTH_TOKEN"]
      ) {
        logger.warn("Twilio not configured, SMS notification skipped");
        return false;
      }

      // Here you would integrate with Twilio
      // For now, we'll log the SMS
      logger.info(`SMS sent to ${to}: ${message}`, {
        tenantId,
        metadata,
        service: "notification",
      });

      // TODO: Implement actual Twilio integration
      // const twilioClient = require('twilio')(accountSid, authToken);
      // await twilioClient.messages.create({
      //   body: message,
      //   from: process.env.TWILIO_PHONE_NUMBER,
      //   to: to
      // });

      return true;
    } catch (error) {
      logger.error("Failed to send SMS:", error);
      return false;
    }
  }

  /**
   * Send email notification
   */
  static async sendEmail(emailData: EmailNotificationData): Promise<boolean> {
    try {
      const {
        to,
        subject,
        body: _emailBody,
        tenantId,
        isHTML = false,
        attachments,
      } = emailData;

      // Validate email
      if (!this.isValidEmail(to)) {
        throw new Error("Invalid email format");
      }

      // Check if SMTP is configured
      if (!process.env["SMTP_HOST"] || !process.env["SMTP_USER"]) {
        logger.warn("SMTP not configured, email notification skipped");
        return false;
      }

      // Here you would integrate with your email service
      // For now, we'll log the email
      logger.info(`Email sent to ${to}: ${subject}`, {
        tenantId,
        isHTML,
        hasAttachments: attachments ? attachments.length > 0 : false,
        service: "notification",
      });

      // TODO: Implement actual email integration
      // const nodemailer = require('nodemailer');
      // const transporter = nodemailer.createTransporter({
      //   host: process.env.SMTP_HOST,
      //   port: process.env.SMTP_PORT,
      //   secure: true,
      //   auth: {
      //     user: process.env.SMTP_USER,
      //     pass: process.env.SMTP_PASS
      //   }
      // });
      // await transporter.sendMail({
      //   from: process.env.SMTP_USER,
      //   to: to,
      //   subject: subject,
      //   html: isHTML ? body : undefined,
      //   text: isHTML ? undefined : body,
      //   attachments: attachments
      // });

      return true;
    } catch (error) {
      logger.error("Failed to send email:", error);
      return false;
    }
  }

  /**
   * Send push notification
   */
  static async sendPushNotification(
    pushData: PushNotificationData
  ): Promise<boolean> {
    try {
      const {
        userId,
        title,
        body: _pushBody,
        tenantId,
        data,
        badge,
        sound,
      } = pushData;

      // Here you would integrate with your push notification service
      // For now, we'll log the push notification
      logger.info(`Push notification sent to user ${userId}: ${title}`, {
        tenantId,
        data,
        badge,
        sound,
        service: "notification",
      });

      // TODO: Implement actual push notification integration
      // This could be Firebase Cloud Messaging, Apple Push Notifications, etc.

      return true;
    } catch (error) {
      logger.error("Failed to send push notification:", error);
      return false;
    }
  }

  /**
   * Send order confirmation notification
   */
  static async sendOrderConfirmation(
    orderId: string,
    customerPhone: string,
    customerEmail: string,
    tenantId: string,
    orderDetails: any
  ): Promise<boolean> {
    try {
      const message = `Your order #${orderDetails.orderNumber} has been confirmed! Total: $${orderDetails.finalAmount}`;
      const emailSubject = `Order Confirmation - #${orderDetails.orderNumber}`;
      const emailBody = `
        <h2>Order Confirmation</h2>
        <p>Thank you for your order!</p>
        <p><strong>Order Number:</strong> ${orderDetails.orderNumber}</p>
        <p><strong>Total Amount:</strong> $${orderDetails.finalAmount}</p>
        <p><strong>Status:</strong> ${orderDetails.status}</p>
        <p>We'll notify you when your order is ready.</p>
      `;

      let success = true;

      // Send SMS if phone number provided
      if (customerPhone) {
        const smsSuccess = await this.sendSMS({
          to: customerPhone,
          message,
          tenantId,
          metadata: { orderId, type: "order_confirmation" },
        });
        success = success && smsSuccess;
      }

      // Send email if email provided
      if (customerEmail) {
        const emailSuccess = await this.sendEmail({
          to: customerEmail,
          subject: emailSubject,
          body: emailBody,
          tenantId,
          isHTML: true,
          metadata: { orderId, type: "order_confirmation" },
        });
        success = success && emailSuccess;
      }

      return success;
    } catch (error) {
      logger.error("Failed to send order confirmation:", error);
      return false;
    }
  }

  /**
   * Send order ready notification
   */
  static async sendOrderReadyNotification(
    orderId: string,
    customerPhone: string,
    customerEmail: string,
    tenantId: string,
    orderDetails: any
  ): Promise<boolean> {
    try {
      const message = `Your order #${orderDetails.orderNumber} is ready for pickup!`;
      const emailSubject = `Order Ready - #${orderDetails.orderNumber}`;
      const emailBody = `
        <h2>Order Ready!</h2>
        <p>Your order is ready for pickup!</p>
        <p><strong>Order Number:</strong> ${orderDetails.orderNumber}</p>
        <p><strong>Table:</strong> ${orderDetails.tableNumber || "N/A"}</p>
        <p>Please collect your order at the counter.</p>
      `;

      let success = true;

      // Send SMS if phone number provided
      if (customerPhone) {
        const smsSuccess = await this.sendSMS({
          to: customerPhone,
          message,
          tenantId,
          metadata: { orderId, type: "order_ready" },
        });
        success = success && smsSuccess;
      }

      // Send email if email provided
      if (customerEmail) {
        const emailSuccess = await this.sendEmail({
          to: customerEmail,
          subject: emailSubject,
          body: emailBody,
          tenantId,
          isHTML: true,
          metadata: { orderId, type: "order_ready" },
        });
        success = success && emailSuccess;
      }

      return success;
    } catch (error) {
      logger.error("Failed to send order ready notification:", error);
      return false;
    }
  }

  /**
   * Send payment confirmation
   */
  static async sendPaymentConfirmation(
    orderId: string,
    customerPhone: string,
    customerEmail: string,
    tenantId: string,
    paymentDetails: any
  ): Promise<boolean> {
    try {
      const message = `Payment confirmed for order #${paymentDetails.orderNumber}. Amount: $${paymentDetails.amount}`;
      const emailSubject = `Payment Confirmation - #${paymentDetails.orderNumber}`;
      const emailBody = `
        <h2>Payment Confirmed</h2>
        <p>Your payment has been processed successfully!</p>
        <p><strong>Order Number:</strong> ${paymentDetails.orderNumber}</p>
        <p><strong>Amount Paid:</strong> $${paymentDetails.amount}</p>
        <p><strong>Payment Method:</strong> ${paymentDetails.paymentMethod}</p>
        <p>Thank you for your business!</p>
      `;

      let success = true;

      // Send SMS if phone number provided
      if (customerPhone) {
        const smsSuccess = await this.sendSMS({
          to: customerPhone,
          message,
          tenantId,
          metadata: { orderId, type: "payment_confirmation" },
        });
        success = success && smsSuccess;
      }

      // Send email if email provided
      if (customerEmail) {
        const emailSuccess = await this.sendEmail({
          to: customerEmail,
          subject: emailSubject,
          body: emailBody,
          tenantId,
          isHTML: true,
          metadata: { orderId, type: "payment_confirmation" },
        });
        success = success && emailSuccess;
      }

      return success;
    } catch (error) {
      logger.error("Failed to send payment confirmation:", error);
      return false;
    }
  }

  /**
   * Validate phone number format
   */
  private static isValidPhoneNumber(phone: string): boolean {
    // Basic phone number validation - you can enhance this
    const phoneRegex = /^\+?[\d\s\-\(\)]{10,}$/;
    return phoneRegex.test(phone);
  }

  /**
   * Validate email format
   */
  private static isValidEmail(email: string): boolean {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email);
  }

  /**
   * Get notification statistics
   */
  static async getNotificationStats(
    _tenantId: string,
    days: number = 30
  ): Promise<any> {
    try {
      // This would typically query your notification logs
      // For now, return mock data
      return {
        totalSent: 0,
        smsSent: 0,
        emailsSent: 0,
        pushSent: 0,
        successRate: 0,
        period: `${days} days`,
      };
    } catch (error) {
      logger.error("Failed to get notification stats:", error);
      return null;
    }
  }
}
