# TapTab Restaurant POS Backend

A modern Node.js backend built with Express, TypeScript, and PostgreSQL for the TapTab restaurant POS system. This backend handles all restaurant operations including menu management, order processing, and analytics.

## Features

- **Multi-tenant Architecture**: Complete tenant isolation for restaurant chains
- **Menu Management**: Categories and menu items with full CRUD operations
- **Order Processing**: Complete order lifecycle management
- **Role-based Access Control**: SUPER_ADMIN, TENANT_ADMIN, MANAGER, CASHIER, WAITER, KITCHEN, READONLY
- **Database**: PostgreSQL with raw SQL queries
- **Security**: JWT token verification, input validation, error handling
- **Logging**: Structured logging with Winston and daily rotation
- **TypeScript**: Full TypeScript support with strict type checking

## Tech Stack

- **Runtime**: Node.js
- **Framework**: Express.js
- **Language**: TypeScript
- **Database**: PostgreSQL
- **Database**: PostgreSQL with pg library
- **Authentication**: JWT token verification
- **Validation**: express-validator
- **Security**: helmet, cors, rate limiting
- **Logging**: Winston with daily rotation
- **Monitoring**: Prometheus metrics
- **Development**: ts-node-dev, ESLint

## Prerequisites

- Node.js (v16 or higher)
- PostgreSQL database
- npm or yarn
- JWT tokens from authentication backend

## Installation

1. **Clone the repository**
   ```bash
   git clone <repository-url>
   cd taptab-node
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Set up environment variables**
   ```bash
   cp env.example .env
   ```
   
   Edit `.env` file with your configuration:
   ```env
   NODE_ENV=development
   PORT=3000
   DATABASE_URL="postgresql://username:password@localhost:5432/taptab_restaurant"
   JWT_SECRET=your-super-secret-jwt-key-here
   JWT_REFRESH_SECRET=your-refresh-secret-key-here
   CORS_ORIGIN=http://localhost:3000
   LOG_LEVEL=info
   ```

4. **Set up the database**
   ```bash
   # Run database migrations manually using the SQL files in the migrations/ directory
   # Example: psql your_database_name -f migrations/add_user_order_source.sql
   ```

5. **Start the development server**
   ```bash
   npm run dev
   ```

## Available Scripts

- `npm run dev` - Start development server with hot reload
- `npm run build` - Build the project for production
- `npm start` - Start the production server

- `npm test` - Run tests
- `npm run lint` - Run ESLint
- `npm run lint:fix` - Fix ESLint issues

## API Endpoints

### Authentication

#### POST `/api/v1/auth/verify`
Verify JWT token and get user information.

**Request Body:**
```json
{
  "token": "jwt_token_here"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "user": {
      "id": "user_id",
      "email": "user@example.com",
      "firstName": "John",
      "lastName": "Doe",
      "role": "MANAGER",
      "tenantId": "tenant_id",
      "tenant": {
        "id": "tenant_id",
        "name": "Restaurant Name",
        "slug": "restaurant-slug",
        "logo": "logo_url",
        "colors": {}
      }
    }
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

### Menu Management

#### GET `/api/v1/menu/categories`
Get all categories for the current tenant.

#### POST `/api/v1/menu/categories`
Create a new category (requires MANAGER role or higher).

**Request Body:**
```json
{
  "name": "Appetizers",
  "sortOrder": 1
}
```

#### PUT `/api/v1/menu/categories/:id`
Update a category (requires MANAGER role or higher).

#### DELETE `/api/v1/menu/categories/:id`
Delete a category (requires MANAGER role or higher).

#### PATCH `/api/v1/menu/categories/:id/order`
Reorder categories (requires MANAGER role or higher).

### Menu Items

#### GET `/api/v1/menu/items`
Get all menu items with pagination and filtering.

**Query Parameters:**
- `categoryId` (optional): Filter by category
- `active` (optional): Filter by active status
- `page` (optional): Page number (default: 1)
- `limit` (optional): Items per page (default: 50)
- `search` (optional): Search in name and description

#### POST `/api/v1/menu/items`
Create a new menu item (requires MANAGER role or higher).

**Request Body:**
```json
{
  "name": "Margherita Pizza",
  "description": "Fresh mozzarella, tomato sauce, basil",
  "price": 12.99,
  "categoryId": "category_id",
  "image": "image_url"
}
```

#### PUT `/api/v1/menu/items/:id`
Update a menu item (requires MANAGER role or higher).

#### DELETE `/api/v1/menu/items/:id`
Delete a menu item (requires MANAGER role or higher).

#### PATCH `/api/v1/menu/items/:id/status`
Toggle menu item availability (requires MANAGER role or higher).

### Other Endpoints

- **Orders**: `/api/v1/orders` - Order management (to be implemented)

- **QR Codes**: `/api/v1/qr` - QR code generation (to be implemented)
- **Printers**: `/api/v1/printers` - Printer management (to be implemented)
- **Analytics**: `/api/v1/analytics` - Business analytics (to be implemented)
- **Tenants**: `/api/v1/tenants` - Tenant management (to be implemented)
- **Notifications**: `/api/v1/notifications` - Notification system (to be implemented)
- **Mobile**: `/api/v1/mobile` - Mobile app APIs (to be implemented)

## Database Schema

The application uses the following main entities:

- **Tenants**: Restaurant chains with multi-tenant isolation

- **Categories**: Menu categories with sorting
- **MenuItems**: Menu items with pricing and availability
- **Orders**: Order management with status tracking
- **OrderItems**: Individual items in orders
- **Payments**: Payment processing and tracking
- **Tables**: Restaurant table management
- **Printers**: Printer configuration for receipts
- **Notifications**: Real-time notifications
- **AuditLogs**: Complete audit trail for all operations

## Error Handling

The API returns consistent error responses:

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Error description"
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

For validation errors:
```json
{
  "success": false,
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Validation failed",
    "details": [
      {
        "field": "email",
        "message": "Invalid email format"
      }
    ]
  },
  "timestamp": "2024-01-15T10:30:00Z"
}
```

## Security Features

- JWT token verification
- Role-based access control (RBAC)
- Multi-tenant data isolation
- Input validation and sanitization
- CORS protection
- Helmet security headers
- Rate limiting and speed limiting
- SQL injection protection through parameterized queries

## Development

### Project Structure

```
src/
├── index.ts              # Main server entry point
├── middleware/           # Express middleware
│   ├── auth.ts          # Authentication middleware
│   ├── errorHandler.ts  # Error handling
│   └── notFoundHandler.ts # 404 handler
├── routes/              # API routes
│   ├── auth.ts          # Authentication routes
│   ├── users.ts         # User management routes
│   └── posts.ts         # Post management routes
└── utils/               # Utility functions
    ├── database.ts      # Database utilities
    └── logger.ts        # Logging utilities
```

### Adding New Features

1. Create new route files in `src/routes/`
2. Add middleware in `src/middleware/` if needed
3. Update the main `index.ts` to include new routes
4. Add database migrations if schema changes are needed

## Production Deployment

1. Set `NODE_ENV=production`
2. Use a strong `JWT_SECRET`
3. Configure proper CORS origins
4. Set up a production PostgreSQL database
5. Use a process manager like PM2
6. Set up proper logging and monitoring

## Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Add tests if applicable
5. Submit a pull request

## License

MIT License 