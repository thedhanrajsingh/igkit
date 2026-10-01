import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/app/generated/prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma?: PrismaClient;
};

function createPrismaClient() {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL environment variable is required");
  }

  // pg.Pool defaults to 10 per process; two warm serverless instances exhausted
  // Supabase's 15-connection pooler ("Can't reach database server").
  return new PrismaClient({
    adapter: new PrismaPg({
      connectionString: databaseUrl,
      max: Number(process.env.DB_POOL_MAX ?? 3),
      idleTimeoutMillis: 10_000,
    }),
  });
}

export const prisma = new Proxy({} as PrismaClient, {
  get(_target, prop, receiver) {
    globalForPrisma.prisma ??= createPrismaClient();
    return Reflect.get(globalForPrisma.prisma, prop, receiver);
  },
});
