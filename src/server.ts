import { app } from './app.js'
import { env } from './shared/config/env.js'

app.listen(env.PORT, () => {
  console.warn(`API listening on http://localhost:${env.PORT}`)
})
