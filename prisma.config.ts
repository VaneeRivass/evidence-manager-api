import 'dotenv/config'
import { defineConfig } from 'prisma/config'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Direct, never pooled: migrations need a stable session. See docs/adr/0002.
    // process.env rather than env(): `prisma generate` must run without it in CI.
    url: process.env.DIRECT_URL,
  },
})
