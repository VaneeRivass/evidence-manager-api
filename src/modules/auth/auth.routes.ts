import { Router } from 'express'
import { validate } from '../../shared/middleware/validate.js'
import { register } from './auth.controller.js'
import { registerSchema } from './auth.schema.js'

export const authRouter = Router()

authRouter.post('/register', validate(registerSchema), register)
