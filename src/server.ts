import { app } from './app.js'
import { env } from './shared/config/env.js'
import { logger } from './shared/logging/logger.js'

app.listen(env.PORT, () => {
  logger.info(`API listening on http://localhost:${env.PORT}`)
})
