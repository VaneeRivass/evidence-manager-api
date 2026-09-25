import { Router } from 'express'
import { validate } from '../../shared/middleware/validate.js'
import { login, register } from './auth.controller.js'
import { loginSchema, registerSchema } from './auth.schema.js'

export const authRouter = Router()

authRouter.post('/register', validate(registerSchema), register)
authRouter.post('/login', validate(loginSchema), login)
