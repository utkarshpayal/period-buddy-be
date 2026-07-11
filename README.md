# Period Buddy - Backend API

A production-ready authentication system built with Node.js, Express, and MongoDB.

Full production API reference for all Period Buddy frontend features is available in [API_DOCUMENTATION.md](./API_DOCUMENTATION.md).

## Features

- ✅ User Registration (Signup)
- ✅ User Login with JWT Authentication
- ✅ Secure Password Hashing (bcrypt)
- ✅ JWT Token Management
- ✅ User Profile Management
- ✅ Password Change Functionality
- ✅ Account Deletion
- ✅ Input Validation & Sanitization
- ✅ Error Handling
- ✅ Security Headers (Helmet)
- ✅ CORS Support
- ✅ MongoDB Integration

## Project Structure

```
src/
├── config/           # Configuration files (database, etc.)
├── models/           # Mongoose models
├── schemas/          # Validation schemas
├── controllers/      # Request handlers
├── middleware/       # Custom middleware
├── routes/           # API routes
├── utils/            # Utility functions
└── constants/        # Constants and messages
```

## Installation

1. **Clone the repository:**
```bash
git clone <repository-url>
cd period-buddy-be
```

2. **Install dependencies:**
```bash
npm install
```

3. **Setup environment variables:**
```bash
cp .env.example .env
```

4. **Update `.env` file with your configuration:**
```env
MONGODB_URI=mongodb://localhost:27017/period-buddy
PORT=5000
NODE_ENV=development
JWT_SECRET=your_super_secret_jwt_key_change_this_in_production
JWT_EXPIRE=7d
BCRYPT_ROUNDS=10
```

5. **Start MongoDB** (if running locally):
```bash
mongod
```

6. **Run the server:**
```bash
# Development mode with auto-reload
npm run dev

# Production mode
npm start
```

## API Endpoints

### Authentication Routes (Base: `/api/auth`)

#### 1. **Signup** - `POST /api/auth/signup`
Register a new user.

**Request Body:**
```json
{
  "firstName": "John",
  "lastName": "Doe",
  "email": "john@example.com",
  "password": "SecurePass123!",
  "confirmPassword": "SecurePass123!",
  "phone": "+1234567890",
  "dateOfBirth": "1990-01-15",
  "gender": "male"
}
```

**Success Response (201):**
```json
{
  "success": true,
  "statusCode": 201,
  "message": "User registered successfully",
  "data": {
    "_id": "user_id",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "role": "user",
    "createdAt": "2024-01-01T00:00:00.000Z"
  },
  "token": "jwt_token_here"
}
```

---

#### 2. **Login** - `POST /api/auth/login`
Login an existing user.

**Request Body:**
```json
{
  "email": "john@example.com",
  "password": "SecurePass123!"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Login successful",
  "data": {
    "_id": "user_id",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "role": "user"
  },
  "token": "jwt_token_here"
}
```

---

#### 3. **Get Profile** - `GET /api/auth/profile`
Get the current user's profile.

**Headers:**
```
Authorization: Bearer <token>
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Profile fetched successfully",
  "data": {
    "_id": "user_id",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@example.com",
    "phone": "+1234567890",
    "gender": "male"
  }
}
```

---

#### 4. **Update Profile** - `PUT /api/auth/profile`
Update the current user's profile.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "firstName": "Jane",
  "lastName": "Smith",
  "phone": "+0987654321",
  "gender": "female"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Profile updated successfully",
  "data": {
    "_id": "user_id",
    "firstName": "Jane",
    "lastName": "Smith",
    "email": "john@example.com",
    "phone": "+0987654321",
    "gender": "female"
  }
}
```

---

#### 5. **Change Password** - `POST /api/auth/change-password`
Change the current user's password.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "currentPassword": "SecurePass123!",
  "newPassword": "NewSecurePass456!"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Password changed successfully"
}
```

---

#### 6. **Logout** - `POST /api/auth/logout`
Logout the current user.

**Headers:**
```
Authorization: Bearer <token>
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Logout successful"
}
```

---

#### 7. **Delete Account** - `DELETE /api/auth/delete-account`
Delete the current user's account.

**Headers:**
```
Authorization: Bearer <token>
```

**Request Body:**
```json
{
  "password": "SecurePass123!"
}
```

**Success Response (200):**
```json
{
  "success": true,
  "statusCode": 200,
  "message": "Account deleted successfully"
}
```

---

## Password Requirements

Passwords must meet the following criteria:
- Minimum 8 characters
- At least one uppercase letter (A-Z)
- At least one lowercase letter (a-z)
- At least one digit (0-9)
- At least one special character (@$!%*?&)

Example: `SecurePass123!`

## Error Responses

### 400 - Bad Request
```json
{
  "success": false,
  "statusCode": 400,
  "message": "Invalid request"
}
```

### 401 - Unauthorized
```json
{
  "success": false,
  "statusCode": 401,
  "message": "Invalid or expired token"
}
```

### 409 - Conflict
```json
{
  "success": false,
  "statusCode": 409,
  "message": "Email already registered"
}
```

### 422 - Unprocessable Entity (Validation Error)
```json
{
  "success": false,
  "statusCode": 422,
  "message": "Validation failed",
  "errors": [
    {
      "field": "email",
      "message": "Please provide a valid email address"
    }
  ]
}
```

### 500 - Internal Server Error
```json
{
  "success": false,
  "statusCode": 500,
  "message": "Internal server error"
}
```

## Security Features

- **Password Hashing**: Passwords are hashed using bcrypt with 10 rounds of salt
- **JWT Tokens**: Secure token-based authentication with 7-day expiration
- **Helmet**: Adds security headers to Express responses
- **CORS**: Configured to allow cross-origin requests
- **Input Validation**: All inputs are validated and sanitized
- **Email Uniqueness**: Ensures no duplicate emails
- **Password Strength**: Enforces strong password requirements

## Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `MONGODB_URI` | MongoDB connection string | `mongodb://localhost:27017/period-buddy` |
| `PORT` | Server port | `5000` |
| `NODE_ENV` | Environment mode | `development` |
| `JWT_SECRET` | JWT signing secret | Required in production |
| `JWT_EXPIRE` | JWT expiration time | `7d` |
| `BCRYPT_ROUNDS` | Bcrypt salt rounds | `10` |

## Development

### Running Development Server
```bash
npm run dev
```

### Running Tests (to be implemented)
```bash
npm test
```

## Production Deployment

1. Set `NODE_ENV=production`
2. Use a strong `JWT_SECRET`
3. Configure MongoDB Atlas or production database
4. Set up environment variables on your hosting platform
5. Use a process manager like PM2:
```bash
npm install -g pm2
pm2 start index.js --name "period-buddy-be"
```

## Database Indexes

The application creates indexes on:
- `email` - For faster user lookups during login/signup

## Future Enhancements

- Email verification
- Refresh tokens
- Password reset functionality
- Two-factor authentication
- OAuth integration (Google, GitHub)
- Rate limiting
- Request logging
- API documentation with Swagger

## License

ISC

## Support

For issues and feature requests, please create an issue in the repository.

## Author

Your Name/Team

---

**Happy Coding!** 🚀
# period-buddy-be
