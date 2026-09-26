import { Router } from 'express'
import { requireAuth } from './require-auth.js'
import { validate } from '../../shared/middleware/validate.js'
import { login, logout, me, register } from './auth.controller.js'
import { loginSchema, registerSchema } from './auth.schema.js'

export const authRouter = Router()

authRouter.post('/register', validate(registerSchema), register)
authRouter.post('/login', validate(loginSchema), login)
authRouter.get('/me', requireAuth, me)
authRouter.post('/logout', requireAuth, logout)
